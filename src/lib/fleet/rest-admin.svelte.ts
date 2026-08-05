/**
 * REST-based admin store. Replaces the WS-based AdminStore.
 *
 * Talks to each discovered device directly — no central broker. Device
 * list comes from /api/devices (mDNS peers + self) on the serving Pi.
 * Status polls each device's /api/status every 5 s. Admin writes go out
 * as:
 *   POST /api/command  { type: 'set_scene' | 'set_mode' | 'set_config', … }
 *   PATCH /api/config  { path, value, timestamp, sourceId }
 *
 * /api/command carries the legacy flat DisplayConfig shape so the device
 * browser applies via model.applyPatch — preserves v1 semantics. PATCH
 * /api/config with timestamp+sourceId engages the CRDT merge for
 * multi-admin concurrent writes.
 */

import type {
	DisplayConfig,
	DeviceInfo,
} from '$lib/fleet/protocol';
import type { LocationId, WeatherType, DisplayMode } from '$lib/types';
import { urlFor, STATUS_INTERVAL_MS, PEER_REFRESH_INTERVAL_MS } from '$lib/fleet/protocol';
import { peerJsonHeaders } from '$lib/http/peer-token';

type ConnectionState = 'connecting' | 'connected' | 'degraded' | 'disconnected';

interface FleetHealth {
	total: number;
	online: number;
	offline: number;
	avgFps: number;
	lowFpsCount: number;
}

interface HealthAlert {
	level: 'error' | 'warning';
	device: string;
	message: string;
}

interface DiscoveredPeer {
	deviceId: string;
	host: string;
	port: number;
	self?: boolean;
}

function adminSourceId(): string {
	if (typeof localStorage === 'undefined') return 'admin';
	const key = 'aero-admin-session-id';
	let id = localStorage.getItem(key);
	if (!id) {
		id = `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		localStorage.setItem(key, id);
	}
	return id;
}

export class RestAdminStore {
	// $state.raw on the array references: every update is a full
	// reassignment (this.devices = this.devices.map(...)) — fine-grained
	// proxy reactivity buys nothing and costs traversal overhead.
	devices = $state.raw<DeviceInfo[]>([]);
	fleetHealth = $state<FleetHealth>({ total: 0, online: 0, offline: 0, avgFps: 0, lowFpsCount: 0 });
	alerts = $state.raw<HealthAlert[]>([]);

	#peers: DiscoveredPeer[] = [];
	#statusInterval: ReturnType<typeof setInterval> | null = null;
	#discoveryInterval: ReturnType<typeof setInterval> | null = null;
	#destroyed = false;
	#sourceId: string;
	#connection = $state<ConnectionState>('connecting');

	get connectionState(): ConnectionState { return this.#connection; }
	get isDestroyed(): boolean { return this.#destroyed; }
	/** Discovered peer addresses. Read by peer-sync's $effect. */
	get peers(): ReadonlyArray<DiscoveredPeer> { return this.#peers; }

	constructor() {
		this.#sourceId = adminSourceId();
		this.refresh();
		// Two cadences:
		//   status poll  — every 5 s, per-peer /api/status GET
		//   discovery    — every 30 s, re-read /api/devices so new Pis appear
		//                  without a manual page refresh. Matches mDNS
		//                  ANNOUNCE_INTERVAL_MS — no point polling faster.
		this.#statusInterval = setInterval(() => this.#pollStatus(), STATUS_INTERVAL_MS);
		this.#discoveryInterval = setInterval(() => this.refresh(), PEER_REFRESH_INTERVAL_MS);
	}

	destroy(): void {
		this.#destroyed = true;
		if (this.#statusInterval) clearInterval(this.#statusInterval);
		if (this.#discoveryInterval) clearInterval(this.#discoveryInterval);
	}

	/** Initial discover + status fetch. Also exposed so admin UI can manually refresh. */
	async refresh(): Promise<void> {
		if (this.#destroyed) return;
		this.#connection = 'connecting';
		try {
			const res = await fetch('/api/devices', { cache: 'no-store' });
			if (!res.ok) throw new Error(`devices ${res.status}`);
			const body = await res.json() as { devices: DiscoveredPeer[] };
			this.#peers = body.devices;
			// Seed device rows with placeholder status; #pollStatus will fill.
			this.devices = this.#peers.map((p) => ({
				deviceId: p.deviceId,
				hostname: p.host,
				currentMode: 'flight',
				currentLocation: 'dubai' as LocationId,
				fps: 0,
				uptime: 0,
				lastSeen: 0,
				online: false,
			}));
			await this.#pollStatus();
			this.#connection = this.devices.some((d) => d.online) ? 'connected' : 'degraded';
		} catch (e) {
			console.warn('[admin] refresh failed:', (e as Error).message);
			this.#connection = 'disconnected';
		}
	}

	async #pollStatus(): Promise<void> {
		if (this.#destroyed) return;
		const results = await Promise.all(
			this.#peers.map(async (peer): Promise<Partial<DeviceInfo> & { deviceId: string }> => {
				try {
					const res = await fetch(`${urlFor(peer)}/api/status`, {
						signal: AbortSignal.timeout(3000),
						cache: 'no-store',
					});
					if (!res.ok) return { deviceId: peer.deviceId, online: false };
					const status = await res.json();
					return {
						deviceId: peer.deviceId,
						hostname: status.hostname ?? peer.host,
						fps: status.fps ?? 0,
						currentMode: status.mode ?? 'flight',
						currentLocation: status.location ?? 'dubai',
						uptime: status.uptime ?? 0,
						lastSeen: status.lastSeen ?? Date.now(),
						online: status.online !== false,
						// Hardening fields — absent from older fielded builds (optional).
						commit: status.commit,
						errorCount: status.errorCount,
						lastErrors: status.lastErrors,
					};
				} catch {
					return { deviceId: peer.deviceId, online: false };
				}
			}),
		);
		const byId = new Map(results.map((r) => [r.deviceId, r] as const));
		this.devices = this.devices.map((d) => ({ ...d, ...(byId.get(d.deviceId) ?? {}) }));
		this.#recomputeHealth();
	}

	#recomputeHealth(): void {
		const online = this.devices.filter((d) => d.online);
		const offline = this.devices.filter((d) => !d.online);
		const avgFps = online.length > 0
			? online.reduce((sum, d) => sum + d.fps, 0) / online.length
			: 0;
		const lowFps = online.filter((d) => d.fps > 0 && d.fps < 30);
		this.fleetHealth = {
			total: this.devices.length,
			online: online.length,
			offline: offline.length,
			avgFps: Math.round(avgFps * 10) / 10,
			lowFpsCount: lowFps.length,
		};
		this.alerts = [
			...offline.map((d) => ({ level: 'error' as const, device: d.deviceId, message: `${d.hostname || d.deviceId} is offline` })),
			...lowFps.map((d) => ({ level: 'warning' as const, device: d.deviceId, message: `${d.hostname || d.deviceId} low FPS: ${d.fps.toFixed(0)}` })),
		];
	}

	#peerFor(deviceId: string): DiscoveredPeer | undefined {
		return this.#peers.find((p) => p.deviceId === deviceId);
	}

	// Throws on non-2xx or network error so caller's fanOut() (which treats a
	// throw as failure) reports truthfully. Missing-peer-token is allowed to
	// resolve silently — `getPeerToken` falls back to the operator's session
	// and the failing-peer hint belongs in the per-peer handler, not here.
	async #postCommand(peer: DiscoveredPeer, body: { type: string; [k: string]: unknown }): Promise<void> {
		const res = await fetch(`${urlFor(peer)}/api/command`, {
			method: 'POST',
			headers: await peerJsonHeaders(),
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			throw new Error(`HTTP ${res.status} from ${peer.deviceId}`);
		}
	}
	async pushScene(deviceId: string, location: LocationId, weather?: WeatherType): Promise<void> {
		const peer = this.#peerFor(deviceId);
		if (!peer) return;
		await this.#postCommand(peer, { type: 'set_scene', location, weather });
	}

	async pushMode(deviceId: string, mode: DisplayMode, payload?: string): Promise<void> {
		const peer = this.#peerFor(deviceId);
		if (!peer) return;
		await this.#postCommand(peer, { type: 'set_mode', mode, payload });
	}

	/**
	 * Push a scene-draft DTO — one-shot "command this device to be X." Ships
	 * as a `set_config` command; device applies through model.applyPatch (the
	 * DTO adapter that decomposes into typed setters + config PATCHes).
	 *
	 * This is for SCENE state (altitude, timeOfDay, weather, flightSpeed,
	 * syncToRealTime) — things that aren't in the config tree. Ambient config
	 * (clouds, haze, lights, quality) auto-propagates via peer-sync, so it
	 * does NOT belong in a scene push.
	 */
	async pushSceneFull(deviceId: string, scene: Partial<DisplayConfig>): Promise<void> {
		const peer = this.#peerFor(deviceId);
		if (!peer) return;
		await this.#postCommand(peer, { type: 'set_config', patch: scene });
	}

	/**
	 * CRDT-aware per-path patch. Stamps {timestamp, sourceId} so concurrent
	 * admin writes on different fields both survive on each device.
	 */
	async pushConfigPath(deviceId: string, path: string, value: unknown): Promise<void> {
		const peer = this.#peerFor(deviceId);
		if (!peer) return;
		const res = await fetch(`${urlFor(peer)}/api/config`, {
			method: 'PATCH',
			headers: await peerJsonHeaders(),
			body: JSON.stringify({ path, value, timestamp: Date.now(), sourceId: this.#sourceId }),
		});
		if (!res.ok) {
			throw new Error(`HTTP ${res.status} from ${peer.deviceId}`);
		}
	}
	/**
	 * Trigger the OTA updater on one device NOW, instead of waiting up to 15 min
	 * for its timer. Returns a result rather than console.warn-ing into the void
	 * like the fire-and-forget command helpers above: the two likely failures are
	 * operator-actionable and indistinguishable from "nothing happened" —
	 * 503 means AERO_ADMIN_TOKEN is unset on THAT Pi, a network error means it's
	 * unreachable. The caller surfaces both.
	 *
	 * A success here only means the update STARTED. The device will drop offline
	 * while it rebuilds and restarts; the real confirmation is its commit chip
	 * changing on the next status poll.
	 */
	async triggerUpdate(deviceId: string): Promise<{ ok: boolean; detail?: string }> {
		const peer = this.#peerFor(deviceId);
		if (!peer) return { ok: false, detail: 'device not discovered' };
		try {
			const res = await fetch(`${urlFor(peer)}/api/update`, {
				method: 'POST',
				headers: await peerJsonHeaders(),
			});
			if (res.ok) return { ok: true };
			return {
				ok: false,
				detail: res.status === 503 ? 'AERO_ADMIN_TOKEN unset on device' : `HTTP ${res.status}`,
			};
		} catch (e) {
			return { ok: false, detail: (e as Error).message };
		}
	}

	/** Update every discovered device. Staggered is unnecessary — each Pi's own
	 *  updater exits in ~2 s when `release` hasn't moved. */
	async broadcastUpdate(): Promise<Array<{ deviceId: string; ok: boolean; detail?: string }>> {
		return Promise.all(
			this.#peers.map(async (p) => ({ deviceId: p.deviceId, ...(await this.triggerUpdate(p.deviceId)) })),
		);
	}
}

