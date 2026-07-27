/**
 * Admin actions — extracted from admin/+page.svelte.
 *
 * Self-contained async functions for OTA updates and scene/mode push.
 * Take peer state + device lists as parameters, return results.
 * Pure: no $state, no Svelte imports — callers own the reactive wiring.
 */

import type { LocationId, WeatherType, DisplayMode } from '$lib/types';

export interface PeerRef {
	deviceId: string;
	host: string;
	port: number;
}

export interface PushResult {
	ok: number;
	failed: string[];
}

export interface SceneState {
	location: LocationId;
	weather: WeatherType;
}

export interface AdminStoreLike {
	peers: PeerRef[];
	broadcastScene(location: LocationId, weather: WeatherType): Promise<void>;
	pushScene(deviceId: string, location: LocationId, weather: WeatherType): Promise<void>;
	pushMode(deviceId: string, mode: DisplayMode, payload?: string): Promise<void>;
}

/** Trigger OTA update on target devices via POST /api/command { type: 'update' }. */
export async function pushOtaUpdate(
	targets: string[],
	peers: PeerRef[],
): Promise<PushResult> {
	const results = await Promise.all(
		targets.map(async (id) => {
			const peer = peers.find((p) => p.deviceId === id);
			if (!peer) return { id, ok: false, detail: 'peer not found' };
			try {
				const base = `http://${peer.host}:${peer.port}`;
				const res = await fetch(`${base}/api/command`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ type: 'update' }),
				});
				return { id, ok: res.ok, detail: res.ok ? '' : `HTTP ${res.status}` };
			} catch (e) {
				return { id, ok: false, detail: String(e) };
			}
		}),
	);
	return {
		ok: results.filter((r) => r.ok).length,
		failed: results.filter((r) => !r.ok).map((r) => `${r.id.slice(0, 8)}: ${r.detail ?? 'failed'}`),
	};
}

/** Push scene to target devices. Broadcasts when all devices selected. */
export async function pushScene(
	store: AdminStoreLike,
	targets: string[],
	totalDevices: number,
	scene: SceneState,
): Promise<PushResult> {
	if (targets.length === totalDevices && totalDevices > 0) {
		await store.broadcastScene(scene.location, scene.weather);
		return { ok: targets.length, failed: [] };
	}
	const results = await Promise.all(
		targets.map(async (id) => {
			try {
				await store.pushScene(id, scene.location, scene.weather);
				return { ok: true };
			} catch (e) {
				return { ok: false, detail: String(e) };
			}
		}),
	);
	return {
		ok: results.filter((r) => r.ok).length,
		failed: results.filter((r) => !r.ok).map((r, i) => `${targets[i].slice(0, 8)}: ${(r as { detail?: string }).detail}`),
	};
}

/** Push display mode to target devices. Broadcasts when all selected. */
export async function pushMode(
	store: AdminStoreLike,
	targets: string[],
	totalDevices: number,
	mode: DisplayMode,
	payload?: string,
): Promise<PushResult> {
	if (targets.length === totalDevices && totalDevices > 0) {
		const results = await Promise.all(
			targets.map(async (id) => {
				try {
					await store.pushMode(id, mode, payload);
					return { ok: true };
				} catch (e) {
					return { ok: false, detail: String(e) };
				}
			}),
		);
		return {
			ok: results.filter((r) => r.ok).length,
			failed: results.filter((r) => !r.ok).map((r, i) => `${targets[i].slice(0, 8)}: ${(r as { detail?: string }).detail}`),
		};
	}
	const results = await Promise.all(
		targets.map(async (id) => {
			try {
				await store.pushMode(id, mode, payload);
				return { ok: true };
			} catch (e) {
				return { ok: false, detail: String(e) };
			}
		}),
	);
	return {
		ok: results.filter((r) => r.ok).length,
		failed: results.filter((r) => !r.ok).map((r, i) => `${targets[i].slice(0, 8)}: ${(r as { detail?: string }).detail}`),
	};
}
