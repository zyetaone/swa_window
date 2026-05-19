/**
 * Device fleet client — SSE subscriber + REST heartbeat poster + Phase 7
 * leader broadcast fan-out.
 *
 * The Pi's browser opens a long-lived EventSource to its OWN SvelteKit
 * server at `/api/events`. Admin PATCHes the server's /api/config, the
 * server's in-process sse-bus publishes the event, the stream forwards
 * it here, and we apply it through model.applyConfigPatch — same
 * reactive graph that local sliders write to.
 *
 * Heartbeat: browser POSTs {fps, location, mode, uptime} to /api/status
 * every 5 s. Admin dashboard polls that endpoint to populate its table.
 *
 * Leader broadcast: panorama leader's director picks a new location,
 * fires publishV2 → this module POSTs director_decision to every
 * discovered peer's /api/command. Peer's SSE delivers; followers
 * schedule the applyScene at transitionAtMs so all Pis flip together.
 */

import type { FleetClientModel, DisplayConfig } from '$lib/fleet/protocol';
import { isValidLocation } from '$content/locations';
import { isValidWeather, isValidDisplayMode, isValidDeviceRole } from '$lib/types';
import { setParallaxRoleWithSync, applyConfigPatch } from '$lib/model/config-tree.svelte';
import { setCRDTDeviceId } from '$lib/model/crdt-store';
import { urlFor } from '$lib/fleet/peer-url';
import { STATUS_INTERVAL_MS, PEER_REFRESH_INTERVAL_MS } from '$lib/fleet/timings';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'retrying';

function getDeviceId(): string {
	const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
	const urlDeviceId = params.get('device');
	if (urlDeviceId) {
		localStorage.setItem('aero-device-id', urlDeviceId);
		return urlDeviceId;
	}
	const key = 'aero-device-id';
	let id = localStorage.getItem(key);
	if (!id) {
		id = `display-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		localStorage.setItem(key, id);
	}
	return id;
}

interface ConfigPatchEvent {
	path: string;
	value: unknown;
	timestamp?: number;
	sourceId?: string;
}

interface CommandEvent {
	type: string;
	[k: string]: unknown;
}

interface PeerAddress {
	deviceId: string;
	host: string;
	port: number;
}

export class DeviceClient {
	#model: FleetClientModel;
	#deviceId: string;
	#eventSource: EventSource | null = null;
	#statusInterval: ReturnType<typeof setInterval> | null = null;
	#peerInterval: ReturnType<typeof setInterval> | null = null;
	#peers: PeerAddress[] = [];
	#bootTime = Date.now();
	#destroyed = false;
	#state: ConnectionState = $state('disconnected');

	/** Reactive connection state — mirrors old WS transport's `state`. */
	get connectionState(): ConnectionState {
		return this.#state;
	}

	get isDestroyed(): boolean { return this.#destroyed; }

	constructor(model: FleetClientModel) {
		this.#model = model;
		this.#deviceId = getDeviceId();
		// Register the deviceId with the CRDT store so local writes stamp
		// with the right sourceId for cross-device LWW tiebreaks.
		setCRDTDeviceId(this.#deviceId);
		this.connect();
		// Status heartbeat every 5 s, peer-list refresh every 30 s to match
		// mDNS ANNOUNCE_INTERVAL_MS. Both run for the lifetime of the
		// client; disconnect() clears them.
		this.#sendStatus();
		this.#statusInterval = setInterval(() => this.#sendStatus(), STATUS_INTERVAL_MS);
		void this.#refreshPeers();
		this.#peerInterval = setInterval(() => void this.#refreshPeers(), PEER_REFRESH_INTERVAL_MS);
	}

	connect(): void {
		if (this.#destroyed) return;
		this.#state = 'connecting';
		this.#eventSource = new EventSource('/api/events');

		this.#eventSource.addEventListener('open', () => {
			this.#state = 'connected';
		});

		this.#eventSource.addEventListener('connected', () => {
			this.#state = 'connected';
		});

		this.#eventSource.addEventListener('error', () => {
			// EventSource auto-reconnects; we just reflect the state.
			this.#state = this.#destroyed ? 'disconnected' : 'retrying';
		});

		this.#eventSource.addEventListener('config_patch', (ev) => {
			this.#handleConfigPatch(ev as MessageEvent);
		});

		this.#eventSource.addEventListener('command', (ev) => {
			this.#handleCommand(ev as MessageEvent);
		});
	}

	disconnect(): void {
		if (this.#statusInterval) { clearInterval(this.#statusInterval); this.#statusInterval = null; }
		if (this.#peerInterval) { clearInterval(this.#peerInterval); this.#peerInterval = null; }
		this.#eventSource?.close();
		this.#eventSource = null;
		this.#state = 'disconnected';
	}

	destroy(): void {
		this.#destroyed = true;
		this.disconnect();
	}

	/**
	 * Phase 7 leader broadcast — panorama leader fires director_decision
	 * when the director picks a new location. Fan out as POST /api/command
	 * to each discovered peer. Peers' servers publish to their local SSE,
	 * their browsers schedule the applyScene at transitionAtMs so all Pis
	 * flip together.
	 *
	 * Best-effort: each POST is fire-and-forget with a catch; failure to
	 * reach one follower doesn't block the rest. Self is excluded by
	 * deviceId match on the peer list (which /api/devices already flags).
	 */
	publishV2(msg: { v: 2; type: string; [k: string]: unknown }): void {
		if (this.#peers.length === 0) return;
		this.#model.telemetry?.recordEvent('fleet_out', { type: msg.type });
		for (const peer of this.#peers) {
			void fetch(`${urlFor(peer)}/api/command`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(msg),
			}).catch(() => { /* follower unreachable — skip */ });
		}
	}

	async #refreshPeers(): Promise<void> {
		if (this.#destroyed) return;
		try {
			const res = await fetch('/api/devices', { cache: 'no-store' });
			if (!res.ok) return;
			const body = await res.json() as { devices: Array<PeerAddress & { self?: boolean }> };
			this.#peers = body.devices.filter((d) => !d.self && d.deviceId !== this.#deviceId);
		} catch { /* mDNS not populated yet or offline — try again next tick */ }
	}

	#sendStatus(): void {
		if (this.#destroyed) return;
		fetch('/api/status', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				deviceId: this.#deviceId,
				hostname: this.#deviceId,
				fps: this.#model.measuredFps,
				mode: this.#model.displayMode,
				location: this.#model.location,
				weather: this.#model.weather,
				uptime: Math.floor((Date.now() - this.#bootTime) / 1000),
				lastSeen: Date.now(),
			}),
		}).catch(() => { /* heartbeat best-effort — don't pollute console */ });
	}

	#handleConfigPatch(ev: MessageEvent): void {
		let body: ConfigPatchEvent;
		try { body = JSON.parse(ev.data); }
		catch { return; }

		this.#model.telemetry?.recordEvent('fleet_in', { type: 'config_patch' });

		if (typeof body.path !== 'string') return;

		if (typeof body.timestamp === 'number' && typeof body.sourceId === 'string') {
			applyConfigPatch(body.path, body.value, { timestamp: body.timestamp, sourceId: body.sourceId });
		} else {
			this.#model.applyConfigPatch?.(body.path, body.value);
		}
	}

	#handleCommand(ev: MessageEvent): void {
		let msg: CommandEvent;
		try { msg = JSON.parse(ev.data); }
		catch { return; }

		this.#model.telemetry?.recordEvent('fleet_in', { type: msg.type });

		switch (msg.type) {
			case 'set_scene': {
				if (!isValidLocation(msg.location)) break;
				const weather = isValidWeather(msg.weather) ? msg.weather : undefined;
				this.#model.applyScene(msg.location, weather);
				break;
			}
			case 'set_mode': {
				const mode = msg.mode;
				if (isValidDisplayMode(mode)) this.#model.setDisplayMode(mode, msg.payload as string | undefined);
				break;
			}
			case 'set_config': {
				// Flat DisplayConfig coming from admin via /api/command. Routed
				// through the DTO adapter (applyPatch), which validates each
				// field via the typed setters internally — so a partial /
				// malformed patch is safe here. Per-field guards live in
				// model.applyPatch.
				const patch = msg.patch;
				if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
					this.#model.applyPatch(patch as Partial<DisplayConfig>);
				}
				break;
			}
			case 'role_assign': {
				// Validate against the DeviceRole union — earlier we accepted any
				// string, which let a malformed fleet message land bogus values
				// straight into the CRDT + camera config.
				if (isValidDeviceRole(msg.role)) {
					setParallaxRoleWithSync(msg.role);
				}
				if (typeof msg.headingOffsetDeg === 'number') {
					this.#model.applyConfigPatch?.('camera.parallax.headingOffsetDeg', msg.headingOffsetDeg);
				}
				if (typeof msg.fovDeg === 'number') {
					this.#model.applyConfigPatch?.('camera.parallax.fovDeg', msg.fovDeg);
				}
				break;
			}
			case 'director_decision': {
				if (!isValidLocation(msg.locationId)) break;
				const loc = msg.locationId;
				const weather = isValidWeather(msg.weather) ? msg.weather : undefined;
				const transitionAtMs = typeof msg.transitionAtMs === 'number' ? msg.transitionAtMs : Date.now();
				const delay = transitionAtMs - Date.now();
				if (delay < -50) {
					console.warn(`[fleet] director_decision arrived ${-delay}ms late; applying immediately`);
					this.#model.applyScene(loc, weather);
				} else {
					setTimeout(() => this.#model.applyScene(loc, weather), Math.max(0, delay));
				}
				break;
			}
		}
	}
}

/** Factory — same signature as the old WS client so consumers don't change. */
export function createDeviceClient(model: FleetClientModel): DeviceClient {
	return new DeviceClient(model);
}
