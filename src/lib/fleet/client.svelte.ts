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

import type { FleetClientModel } from '$lib/fleet/protocol';
import { isValidLocation } from '$content/locations';
import { isValidWeather, isValidDisplayMode, isValidQualityMode } from '$lib/types';
import { setCRDTDeviceId } from '$lib/model/crdt-store';
import { urlFor, STATUS_INTERVAL_MS, PEER_REFRESH_INTERVAL_MS, transitionDelayMs } from '$lib/fleet/protocol';
import { peerJsonHeaders } from '$lib/http/peer-token';
import { clamp } from '$lib/utils';
import { resolveDeviceId } from '$lib/fleet/device-id';
import { resolveBinding, shouldApplyDirectorDecision } from '$lib/fleet/parallax.svelte';
import { APP_COMMIT } from '$lib/version';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'retrying';

interface ConfigPatchEvent {
	path: string;
	value: unknown;
	timestamp?: number;
	sourceId?: string;
	/** Apply-ack correlation id (admin pushes only — ambient peer-sync omits it). */
	commandId?: string;
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
	// Track pending director_decision setTimeouts so we can cancel them on
	// disconnect/destroy. Without this, a follower receives a transition
	// scheduled +2.5s in the future, the page navigates or HMR fires, the
	// timeout still resolves and calls applyScene() on a torn-down model —
	// either crashes or pins the model + scene in memory beyond GC.
	#pendingTransitions = new Set<ReturnType<typeof setTimeout>>();
	#connection: ConnectionState = $state('disconnected');

	/** Reactive connection state — mirrors old WS transport's `state`. */
	get connectionState(): ConnectionState {
		return this.#connection;
	}

	get isDestroyed(): boolean { return this.#destroyed; }

	constructor(model: FleetClientModel) {
		this.#model = model;
		this.#deviceId = resolveDeviceId();
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
		// Defensive re-entry guard: if a previous EventSource is still
		// open (e.g., reconnect button, programmatic retry), close it
		// before opening a new one so handlers + retry timers in the old
		// instance don't survive past their owner.
		if (this.#eventSource) {
			this.#eventSource.close();
			this.#eventSource = null;
		}
		this.#connection = 'connecting';
		this.#eventSource = new EventSource('/api/events');

		this.#eventSource.addEventListener('open', () => {
			this.#connection = 'connected';
		});

		this.#eventSource.addEventListener('connected', () => {
			this.#connection = 'connected';
		});

		this.#eventSource.addEventListener('error', () => {
			// EventSource auto-reconnects; we just reflect the state.
			this.#connection = this.#destroyed ? 'disconnected' : 'retrying';
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
		// Cancel any scheduled future director_decision applies — without
		// this they'd fire on a torn-down model after disconnect.
		for (const id of this.#pendingTransitions) clearTimeout(id);
		this.#pendingTransitions.clear();
		this.#eventSource?.close();
		this.#eventSource = null;
		this.#connection = 'disconnected';
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
		if (this.#destroyed || this.#peers.length === 0) return;
		this.#model.telemetry?.recordEvent('fleet_out', { type: msg.type });
		// /api/command is bearer-gated; the leader (a kiosk Pi) pulls its own
		// token from the localhost peer-token route. Async IIFE keeps publishV2
		// fire-and-forget/void — the token fetch is cached after warmup.
		// Headers are per-peer: a rogue mDNS SRV target pointing off-LAN gets
		// no Authorization header (see isLanHost in $lib/http/peer-token).
		void (async () => {
			for (const peer of this.#peers) {
				void fetch(`${urlFor(peer)}/api/command`, {
					method: 'POST',
					headers: await peerJsonHeaders(peer.host),
					body: JSON.stringify(msg),
				}).catch(() => { /* follower unreachable — skip */ });
			}
		})();
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
		// Telemetry summary rides the heartbeat so a remote operator sees fps
		// percentiles + the last few errors WITHOUT SSH (production-hardening).
		// All additive optional fields — flat-DTO invariant #2 preserved.
		const tel = this.#model.telemetry;
		const lastErrors = tel
			? tel.events
					.filter((e) => e.kind === 'error')
					.slice(-3)
					.map((e) => {
						try { return JSON.stringify(e.payload).slice(0, 160); }
						catch { return String(e.payload).slice(0, 160); }
					})
			: undefined;
		fetch('/api/status', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				deviceId: this.#deviceId,
				hostname: this.#deviceId,
				// Media parks the globe — report 0 fps so health doesn't show a
				// stale flight median as "healthy rendering" under video/slideshow.
				fps: this.#model.displayMode === 'flight' ? this.#model.measuredFps : 0,
				mode: this.#model.displayMode,
				location: this.#model.location,
				weather: this.#model.weather,
				uptime: Math.floor((Date.now() - this.#bootTime) / 1000),
				lastSeen: Date.now(),
				commit: APP_COMMIT,
				// Apply-ack echo — lets the admin dashboard distinguish
				// "published to SSE" from "applied by the kiosk".
				lastAppliedCommandId: this.#model.lastAppliedCommandId ?? undefined,
				fpsLow: tel?.fpsLow,
				frameMsP50: tel ? Math.round(tel.frameMsP50 * 10) / 10 : undefined,
				frameMsP95: tel ? Math.round(tel.frameMsP95 * 10) / 10 : undefined,
				tickMsP50: tel ? Math.round(tel.tickMsP50 * 100) / 100 : undefined,
				errorCount: tel?.counts.errors,
				lastErrors,
			}),
		}).catch(() => { /* heartbeat best-effort — don't pollute console */ });
	}

	/**
	 * Apply-ack: record the pushed commandId AFTER applying. This acks RECEIPT
	 * — "this device applied the message" — NOT merge outcome: a config patch
	 * that LOSES the CRDT LWW merge still acks (the message was handled even
	 * if its value didn't win), and an SSE ring-buffer replay after reload
	 * re-acks the same id, which is harmless — it is the same command.
	 */
	#recordAck(commandId: unknown): void {
		if (typeof commandId !== 'string' || commandId.length === 0) return;
		this.#model.lastAppliedCommandId = commandId.slice(0, 64);
	}

	#handleConfigPatch(ev: MessageEvent): void {
		let body: ConfigPatchEvent;
		try { body = JSON.parse(ev.data); }
		catch { return; }

		this.#model.telemetry?.recordEvent('fleet_in', { type: 'config_patch' });

		if (typeof body.path !== 'string') return;

		if (typeof body.timestamp === 'number' && typeof body.sourceId === 'string') {
			// Route through the model wrapper (not the config-tree global) so the
			// apply lands in telemetry like every other config_patch. The remote
			// stamp rides along for the CRDT LWW merge.
			this.#model.applyConfigPatch?.(body.path, body.value, {
				remote: { timestamp: body.timestamp, sourceId: body.sourceId },
			});
		} else {
			this.#model.applyConfigPatch?.(body.path, body.value);
		}
		this.#recordAck(body.commandId);
	}

	#handleCommand(ev: MessageEvent): void {
		let msg: CommandEvent;
		try { msg = JSON.parse(ev.data); }
		catch { return; }

		// Corridor gating: group-scoped leader broadcasts (director_decision,
		// vantage_beat, and the leader's ambient-roll set_config — it carries
		// groupId, see #broadcastAmbientJitter) only apply to panes in the
		// targeted corridor — with two corridors on one LAN, each leader must
		// drive ONLY its own group. Absent groupId = legacy unscoped broadcast
		// (admin set_config pushes) = apply (back-compat). Skipped messages are
		// not ours, so they fall out before the fleet_in telemetry record below
		// (not logged as applied).
		if (msg.type === 'director_decision' || msg.type === 'vantage_beat' || msg.type === 'set_config') {
			if (!shouldApplyDirectorDecision(resolveBinding().groupId, msg.groupId as string | undefined)) {
				return;
			}
		}

		this.#model.telemetry?.recordEvent('fleet_in', { type: msg.type });
		switch (msg.type) {
			case 'set_scene': {
				if (!isValidLocation(msg.location)) break;
				const weather = isValidWeather(msg.weather) ? msg.weather : undefined;
				this.#model.applyScene(msg.location, weather);
				this.#recordAck(msg.commandId);
				break;
			}
			case 'set_mode': {
				const mode = msg.mode;
				if (!isValidDisplayMode(mode)) break;
				// decidedAtMs from admin (wall-clock of the push). Missing on
				// legacy commands → Date.now() so they still apply, but cannot
				// undo a *newer* local Escape stored with a later savedAt.
				const decidedAtMs =
					typeof msg.decidedAtMs === 'number' && Number.isFinite(msg.decidedAtMs)
						? (msg.decidedAtMs as number)
						: Date.now();
				this.#model.setDisplayMode(mode, msg.payload as string | undefined, { decidedAtMs });
				this.#recordAck(msg.commandId);
				break;
			}
			case 'set_config': {
				// Legacy flat DisplayConfig → decomposed into typed setter calls
				// (altitude/time/weather/flightSpeed have side effects) and
				// path-targeted patches (cloud density, haze, lights, etc.).
				// /api/command deliberately does NOT validate payloads, so the
				// isValid* gates on enum fields here are the trust boundary.
				const p = msg.patch;
				if (p && typeof p === 'object' && !Array.isArray(p)) {
					const d = p as Record<string, unknown>;
					if (typeof d.altitude === 'number') this.#model.setAltitude(d.altitude);
					if (typeof d.timeOfDay === 'number') this.#model.setTime(d.timeOfDay);
					// Weather-only — NOT applyScene: applyScene flyTo()s the target,
					// and the target here is the CURRENT location, so every leader
					// weather roll made edge panes run a fake cruise (blinds close,
					// warp, reopen). setWeather changes the weather in place.
					if (isValidWeather(d.weather)) this.#model.setWeather?.(d.weather, { trackUserOverride: false });
					if (typeof d.flightSpeed === 'number') this.#model.setFlightSpeed(d.flightSpeed);
					if (typeof d.syncToRealTime === 'boolean') this.#model.syncToRealTime = d.syncToRealTime;
					if (typeof d.cloudDensity === 'number') this.#model.applyConfigPatch?.('atmosphere.clouds.density', clamp(d.cloudDensity, 0, 1));
					// Ambient siblings — the leader's autopilot jitter arrives as all
					// three together (see #broadcastAmbientJitter). Clamps here are the
					// trust boundary, not the authored range: /api/command does not
					// validate payloads.
					if (typeof d.cloudSpeed === 'number') this.#model.applyConfigPatch?.('atmosphere.clouds.speed', clamp(d.cloudSpeed, 0, 3));
					if (typeof d.hazeAmount === 'number') this.#model.applyConfigPatch?.('atmosphere.haze.amount', clamp(d.hazeAmount, 0, 1));
					if (typeof d.showClouds === 'boolean') this.#model.applyConfigPatch?.('world.showClouds', d.showClouds);
					if (typeof d.nightLightIntensity === 'number') this.#model.applyConfigPatch?.('world.nightLightIntensity', clamp(d.nightLightIntensity, 0, 5));
					if (isValidQualityMode(d.qualityMode)) this.#model.setQualityMode(d.qualityMode);
					this.#recordAck(msg.commandId);
				}
				break;
			}
			case 'director_decision': {
				if (!isValidLocation(msg.locationId)) break;
				const loc = msg.locationId;
				const weather = isValidWeather(msg.weather) ? msg.weather : undefined;
				const transitionAtMs = typeof msg.transitionAtMs === 'number' ? msg.transitionAtMs : Date.now();
				const rawLead = transitionAtMs - Date.now();
				// Clamped: a peer with a wrong clock could otherwise schedule us
				// hours out (scene frozen) or past setTimeout's 32-bit ceiling
				// (fires immediately, desyncing the very panorama the schedule
				// protects). See transitionDelayMs.
				const delay = transitionDelayMs(transitionAtMs);
				if (rawLead < -50) {
					console.warn(`[fleet] director_decision arrived ${-rawLead}ms late; applying immediately`);
					this.#model.applyScene(loc, weather);
					this.#recordAck(msg.commandId);
				} else {
					// Track the handle so disconnect() can cancel pending
					// transitions and the closure stops pinning #model.
					// The ack is recorded when the scene ACTUALLY applies (at
					// transitionAtMs), not when the message arrives.
					const id = setTimeout(() => {
						this.#pendingTransitions.delete(id);
						if (this.#destroyed) return;
						this.#model.applyScene(loc, weather);
						this.#recordAck(msg.commandId);
					}, delay);
					this.#pendingTransitions.add(id);
				}
				break;
			}
			case 'vantage_beat': {
				// Leader chose a night-city flyover. Schedule the enter/exit
				// edges off the shared transitionAtMs (the model owns the timers
				// and locks both edges to the same instant as the leader).
				if (typeof msg.transitionAtMs !== 'number') break;
				const durationMs = typeof msg.durationMs === 'number' ? msg.durationMs : 0;
				const pitchDeg = typeof msg.pitchDeg === 'number' ? msg.pitchDeg : 0;
				const altitudeFt = typeof msg.altitudeFt === 'number' ? msg.altitudeFt : 0;
				if (durationMs <= 0 || pitchDeg === 0) break;   // nothing renderable
				this.#model.scheduleFlyover?.({ durationMs, pitchDeg, altitudeFt }, msg.transitionAtMs);
				break;
			}
		}
	}
}

/** Factory — same signature as the old WS client so consumers don't change. */
export function createDeviceClient(model: FleetClientModel): DeviceClient {
	return new DeviceClient(model);
}
