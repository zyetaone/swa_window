/**
 * Utility functions — shared math and formatting helpers used across
 * display, admin, and any future package. SSOT.
 */

import type { SkyState } from './types';

// ── Time-of-day thresholds (SSOT for all night consumers) ──────────────────
// Phase 11 (architecture cleanup): inlined from the deleted $lib/night/ barrel
// since this file IS the night-state derivation home (getSkyState +
// nightFactor + dawnDuskFactor below). Aesthetic constants — visual targets
// like globe colour, sky brightness shift — live in $content/compositions/night.

/**
 * Time-of-day thresholds for the night/dawn/dusk rendering pipeline.
 * All values are decimal hours in local time (same space as model.timeOfDay).
 * Editing one value here keeps all consumers aligned automatically.
 *
 * Consumers:
 *   - getSkyState (below)            categorical state
 *   - nightFactor (below)            0..1 darkness
 *   - dawnDuskFactor (below)         0..1 transition peak
 *   - world/compose.ts               isSunVisible, sun disc visibility
 */
export const T = {
	/** Night ends; dawn transition begins. */
	DAWN_START:  5,
	/** Dawn ends; full daylight. */
	DAY_START:   7,
	/** Full daylight ends; dusk transition begins. */
	DAY_END:    18,
	/** Dusk ends; night begins (blue hour is included in dusk). */
	DUSK_END:   21,
	/** dawnDusk factors reach zero; nightFactor reaches one. */
	DEEP_NIGHT: 22,
} as const;

/**
 * nightFactor floor below which the car-lights geo-effect is hidden.
 * Dots fade in around dusk (nf crosses 0.2) and stay visible through
 * night → dawn until nf drops below 0.2 again.
 */
export const CAR_LIGHTS_NIGHT_THRESHOLD = 0.2;

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between two values.
 */
export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/**
 * Normalize a heading to [0, 360) range.
 */
export function normalizeHeading(heading: number): number {
	return ((heading % 360) + 360) % 360;
}

/**
 * Random number between min and max (inclusive).
 */
export function randomBetween(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

/**
 * Pick a random element from an array.
 */
export function pickRandom<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Shortest-arc delta between two headings in degrees. Result in [-180, 180].
 */
export function shortestAngleDelta(from: number, to: number): number {
	let d = to - from;
	if (d > 180) d -= 360;
	if (d < -180) d += 360;
	return d;
}

/**
 * Derive sky state from decimal time of day.
 */
export function getSkyState(timeOfDay: number): SkyState {
	if (timeOfDay < T.DAWN_START || timeOfDay >= T.DUSK_END) return 'night';
	if (timeOfDay < T.DAY_START) return 'dawn';
	if (timeOfDay >= T.DAY_END) return 'dusk';
	return 'day';
}

/**
 * Night factor 0..1 from decimal time of day.
 * 0 = full day, 1 = full night.
 */
export function nightFactor(timeOfDay: number): number {
	if (timeOfDay >= T.DAY_START && timeOfDay <= T.DAY_END) return 0;
	if (timeOfDay < T.DAWN_START || timeOfDay > T.DEEP_NIGHT) return 1;
	if (timeOfDay < T.DAY_START) return 1 - (timeOfDay - T.DAWN_START) / (T.DAY_START - T.DAWN_START);
	return (timeOfDay - T.DAY_END) / (T.DEEP_NIGHT - T.DAY_END);
}

/**
 * Dawn/dusk factor 0..1 from decimal time of day.
 * Peaks at 0.5 during the transition band, 0 during full day/night.
 * Used by the night-rendering pipeline to tint the color-grading shader
 * toward warm amber at the terminator.
 */
export function dawnDuskFactor(timeOfDay: number): number {
	if (timeOfDay >= T.DAY_START && timeOfDay <= T.DAY_END) return 0;
	if (timeOfDay < T.DAWN_START || timeOfDay > T.DEEP_NIGHT) return 0;
	if (timeOfDay < T.DAY_START) return (timeOfDay - T.DAWN_START) / (T.DAY_START - T.DAWN_START);
	return (T.DEEP_NIGHT - timeOfDay) / (T.DEEP_NIGHT - T.DAY_END);
}

/**
 * Smoothstep easing: 3t² − 2t³. Input clamped to [0, 1].
 * Produces zero derivative at 0 and 1 — good for gate-like alpha fades
 * where linear ramps reveal banding.
 */
export function smoothstep(t: number): number {
	const x = Math.max(0, Math.min(1, t));
	return x * x * (3 - 2 * x);
}

/**
 * Write `value` into `obj` at a dotted path (e.g. 'atmosphere.clouds.density').
 * Returns true on success; false if the path traverses a non-object segment
 * or if the leaf key doesn't already exist on its parent.
 *
 * Used by the config tree dispatcher AND the CRDT store — extracted here to
 * break the circular import those two modules used to have.
 */
// Prototype-pollution defense: any segment naming a JS built-in (the chain
// reachable via Object.prototype) would let setByPath('__proto__.x', ...) or
// setByPath('constructor.prototype.x', ...) write to Object.prototype — global
// poisoning of every plain object in the process. Reject unconditionally.
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** Split and validate a dotted path. Returns segments or null if any segment is forbidden. */
function validatePath(path: string): string[] | null {
	const segments = path.split('.');
	for (const s of segments) {
		if (FORBIDDEN_SEGMENTS.has(s)) return null;
	}
	return segments;
}

/**
 * Read a dotted-path value from a plain object. Mirrors setByPath's guard
 * shape (forbidden segments, own-property only) so callers can pair the two
 * — e.g. "skip the write when readByPath returns the same value." Returns
 * undefined if any traversal step fails.
 */
export function readByPath(obj: Record<string, unknown>, path: string): unknown {
	const segments = validatePath(path);
	if (!segments) return undefined;
	let current: unknown = obj;
	for (const segment of segments) {
		if (typeof current !== 'object' || current === null) return undefined;
		const rec = current as Record<string, unknown>;
		if (!Object.hasOwn(rec, segment)) return undefined;
		current = rec[segment];
	}
	return current;
}

export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): boolean {
	const segments = validatePath(path);
	if (!segments) return false;
	let current: Record<string, unknown> = obj;
	for (let i = 0; i < segments.length - 1; i++) {
		// Object.hasOwn instead of `in` so we never resolve through the
		// prototype chain even if a forbidden-segment guard somehow misses.
		if (!Object.hasOwn(current, segments[i])) return false;
		const next = current[segments[i]];
		if (typeof next !== 'object' || next === null) return false;
		current = next as Record<string, unknown>;
	}
	const key = segments[segments.length - 1];
	if (!Object.hasOwn(current, key)) return false;
	current[key] = value;
	return true;
}

/**
 * Format a decimal time (e.g. 14.5) as "2:30 PM".
 * Handles edge cases: 24 wraps to midnight, negative times normalized.
 */
export function formatTime(time: number): string {
	// Normalize to [0, 24) to handle values like 24.0 or negatives
	const normalized = ((time % 24) + 24) % 24;
	const hours = Math.floor(normalized);
	const minutes = Math.floor((normalized % 1) * 60);
	const period = hours >= 12 ? 'PM' : 'AM';
	const h = hours % 12 || 12;
	return `${h}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Format an uptime in seconds as a compact human-readable duration.
 * `90` → `"1m"`, `7270` → `"2h 1m"`, `42` → `"42s"`.
 * Caller handles the zero/negative case (e.g. show "—" when the device
 * hasn't reported yet).
 */
export function formatUptime(seconds: number): string {
	if (seconds < 60) return `${Math.floor(seconds)}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return `${h}h ${m}m`;
}
