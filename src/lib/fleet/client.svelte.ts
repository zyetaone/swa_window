/**
 * Device fleet client — SSE subscriber + REST heartbeat poster.
 *
 * The Pi's browser opens a long-lived EventSource to its OWN SvelteKit
 * server at `/api/events`. Admin PATCHes the server's /api/config, the
 * server's in-process sse-bus publishes the event, the stream forwards
 * it here, and we apply it to `$state` — same reactive graph that local
 * sliders write to.
 *
 * Heartbeat: browser POSTs {fps, location, mode, uptime} to /api/status
 * every 5 s. Admin dashboard polls that endpoint to populate its table.
 *
 * Replaces the old DisplayWsClient (WS subscription to a central broker)
 * one-for-one — same exports, same `createWsClient(model)` factory, same
 * `publishV2` for Phase 7 leader broadcasts.
 */

import type { FleetClientModel } from '$lib/fleet/protocol';
import { LOCATION_IDS } from '$lib/locations';
import { isValidWeather, isValidDisplayMode } from '$lib/types';
import { setParallaxRoleWithSync, applyRemoteConfigPatch } from '$lib/model/config-tree.svelte';
import { setCRDTDeviceId } from '$lib/model/crdt-store';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'retrying';

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

export class DisplayWsClient {
	#model: FleetClientModel;
	#deviceId: string;
	#eventSource: EventSource | null = null;
	#statusInterval: ReturnType<typeof setInterval> | null = null;
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
		this.#startStatusUpdates();
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
		this.#stopStatusUpdates();
		this.#eventSource?.close();
		this.#eventSource = null;
		this.#state = 'disconnected';
	}

	destroy(): void {
		this.#destroyed = true;
		this.disconnect();
	}

	/**
	 * Phase 7 leader broadcast. Was `server.send({...})` over WS; in REST
	 * mode the leader POSTs a `director_decision` command to each
	 * discovered follower directly. Deferred to Phase D — for now, logs
	 * a warning and drops the message so admin-pushed single-device
	 * flows still work.
	 */
	publishV2(msg: { v: 2; type: string; [k: string]: unknown }): void {
		console.warn('[fleet] publishV2 not wired in REST mode yet:', msg.type);
	}

	#startStatusUpdates(): void {
		this.#stopStatusUpdates();
		const send = () => {
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
		};
		send();
		this.#statusInterval = setInterval(send, 5000);
	}

	#stopStatusUpdates(): void {
		if (this.#statusInterval) {
			clearInterval(this.#statusInterval);
			this.#statusInterval = null;
		}
	}

	#handleConfigPatch(ev: MessageEvent): void {
		let body: ConfigPatchEvent;
		try { body = JSON.parse(ev.data); }
		catch { return; }

		this.#model.telemetry?.recordEvent('fleet_in', { type: 'config_patch' });

		if (typeof body.path !== 'string') return;

		if (typeof body.timestamp === 'number' && typeof body.sourceId === 'string') {
			applyRemoteConfigPatch(body.path, body.value, body.timestamp, body.sourceId);
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
				const location = msg.location as string;
				const weather = msg.weather;
				if (LOCATION_IDS.has(location as never)) {
					this.#model.applyScene(
						location as never,
						isValidWeather(weather) ? (weather as never) : undefined,
					);
				}
				break;
			}
			case 'set_mode': {
				const mode = msg.mode;
				if (isValidDisplayMode(mode)) this.#model.setDisplayMode(mode, msg.payload as string | undefined);
				break;
			}
			case 'role_assign': {
				const role = msg.role;
				if (typeof role === 'string') {
					setParallaxRoleWithSync(role as never);
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
				const loc = msg.locationId as string;
				if (!LOCATION_IDS.has(loc as never)) break;
				const weather = isValidWeather(msg.weather) ? (msg.weather as never) : undefined;
				const transitionAtMs = typeof msg.transitionAtMs === 'number' ? msg.transitionAtMs : Date.now();
				const delay = transitionAtMs - Date.now();
				if (delay < -50) {
					console.warn(`[fleet] director_decision arrived ${-delay}ms late; applying immediately`);
					this.#model.applyScene(loc as never, weather);
				} else {
					setTimeout(() => this.#model.applyScene(loc as never, weather), Math.max(0, delay));
				}
				break;
			}
		}
	}
}

/** Factory — same signature as the old WS client so consumers don't change. */
export function createWsClient(model: FleetClientModel): DisplayWsClient {
	return new DisplayWsClient(model);
}
