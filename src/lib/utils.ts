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
