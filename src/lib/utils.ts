/**
 * Utility functions — shared math and formatting helpers used across
 * display, admin, and any future package. SSOT.
 */

import type { SkyState } from './types';

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
	if (timeOfDay < 5 || timeOfDay >= 20) return 'night';
	if (timeOfDay < 7) return 'dawn';
	if (timeOfDay >= 18) return 'dusk';
	return 'day';
}

/**
 * Night factor 0..1 from decimal time of day.
 * 0 = full day, 1 = full night.
 */
export function nightFactor(timeOfDay: number): number {
	if (timeOfDay >= 7 && timeOfDay <= 18) return 0;
	if (timeOfDay < 5 || timeOfDay > 22) return 1;
	if (timeOfDay < 7) return 1 - (timeOfDay - 5) / 2;
	return (timeOfDay - 18) / 4;
}

/**
 * Dawn/dusk factor 0..1 from decimal time of day.
 * Peaks at 0.5 during the transition band, 0 during full day/night.
 * Used by the night-rendering pipeline to tint the color-grading shader
 * toward warm amber at the terminator.
 */
export function dawnDuskFactor(timeOfDay: number): number {
	if (timeOfDay >= 7 && timeOfDay <= 18) return 0;
	if (timeOfDay < 5 || timeOfDay > 22) return 0;
	if (timeOfDay < 7) return (timeOfDay - 5) / 2;
	if (timeOfDay > 18) return (22 - timeOfDay) / 4;
	return 0;
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
