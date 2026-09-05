/**
 * Fleet fan-out payload builders for AeroWindow (leader → corridor peers).
 *
 * Pure: no runes, no timers. The class owns `#fleetBroadcast` and role gates;
 * these helpers only shape wire messages so autopilot and human flyTo cannot
 * drift.
 */
import { isValidWeather, type LocationId, type WeatherType } from '$lib/types';
import { TRANSITION_DELAY_MS, type DisplayConfig } from '$lib/fleet/protocol';

export type FleetBroadcast = (msg: { v: 2; type: string; [k: string]: unknown }) => void;

/** Map director config patches into the set_config DisplayConfig shape. */
export function buildAmbientJitterPatch(
	configs: Array<{ path: string; value: unknown }>,
): DisplayConfig | null {
	const patch: DisplayConfig = {};
	for (const { path, value } of configs) {
		if (path === 'atmosphere.clouds.density' && typeof value === 'number') patch.cloudDensity = value;
		else if (path === 'atmosphere.clouds.speed' && typeof value === 'number') patch.cloudSpeed = value;
		else if (path === 'atmosphere.haze.amount' && typeof value === 'number') patch.hazeAmount = value;
		else if (path === 'weather' && isValidWeather(value)) patch.weather = value;
	}
	return Object.keys(patch).length === 0 ? null : patch;
}

/**
 * Broadcast ambient jitter as set_config. No-op without a center leader hook.
 * @returns true if a message was sent.
 */
export function broadcastAmbientJitter(
	broadcast: FleetBroadcast | null,
	role: string,
	groupId: string,
	configs: Array<{ path: string; value: unknown }>,
	nowMs: number = Date.now(),
): boolean {
	if (!broadcast || role !== 'center') return false;
	const patch = buildAmbientJitterPatch(configs);
	if (!patch) return false;
	broadcast({
		v: 2,
		type: 'set_config',
		patch,
		decidedAtMs: nowMs,
		groupId,
	});
	return true;
}

/**
 * Broadcast a director_decision for lock-step location change.
 * @returns transitionAtMs on the wire, or null when nothing was sent (solo / no hook).
 */
export function broadcastLocationDecision(
	broadcast: FleetBroadcast | null,
	role: string,
	groupId: string,
	opts: {
		locationId: LocationId;
		scenarioId: string;
		weather: WeatherType;
		nowMs?: number;
		delayMs?: number;
	},
): number | null {
	if (!broadcast || role !== 'center') return null;
	const now = opts.nowMs ?? Date.now();
	const delay = opts.delayMs ?? TRANSITION_DELAY_MS;
	const transitionAtMs = now + delay;
	broadcast({
		v: 2,
		type: 'director_decision',
		scenarioId: opts.scenarioId,
		locationId: opts.locationId,
		weather: opts.weather,
		decidedAtMs: now,
		transitionAtMs,
		groupId,
	});
	return transitionAtMs;
}
