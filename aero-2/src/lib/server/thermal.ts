/**
 * Reading the thermal state health-check.sh leaves on disk.
 *
 * The action is ALWAYS re-derived here from the temperature and the flags, and
 * the file's own `action` is used only as the previous value the hysteresis
 * band needs. A file that says `shed` after the Pi has cooled cannot pin the
 * wall in performance mode, and hand-editing the JSON cannot force it either.
 */

import { existsSync, readFileSync } from 'node:fs';

import {
	decodeThrottleFlags,
	parseThrottledRaw,
	thermalAction,
	type ThermalAction,
	type ThermalState
} from '#lib/throttle.js';

export const DEFAULT_THERMAL_PATH = '/run/aero/thermal.json';

/**
 * `state: null` with a reason, never a bare 204.
 *
 * A 204 forces the client to guess whether thermal is fine or simply absent,
 * and those render identically — the same silence `x-aero-dataset: missing`
 * exists to prevent on the tile side. A dev host and a Pi whose health-check
 * died must not look the same.
 */
export type ThermalRead =
	{ state: ThermalState; reason?: undefined } | { state: null; reason: string };

export function readThermalState(path = DEFAULT_THERMAL_PATH): ThermalRead {
	if (!existsSync(path)) {
		return { state: null, reason: `no thermal state at ${path} — health-check.sh has not run` };
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
	} catch {
		return { state: null, reason: `thermal state at ${path} is unreadable or not JSON` };
	}

	const tempC = num(parsed.tempC);
	const throttledRaw = parseThrottledRaw(parsed.throttledRaw);
	const flags = decodeThrottleFlags(throttledRaw);
	const prev: ThermalAction = parsed.action === 'shed' ? 'shed' : 'ok';

	return {
		state: {
			tempC,
			throttledRaw,
			action: thermalAction(tempC, flags, prev),
			updatedAtMs: num(parsed.updatedAtMs),
			flags
		}
	};
}

function num(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
