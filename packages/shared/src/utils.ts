/**
 * Utility Functions
 *
 * Shared math and formatting functions used across the application.
 */

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between two values
 */
export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/**
 * Normalize a heading to [0, 360) range
 */
export function normalizeHeading(heading: number): number {
	return ((heading % 360) + 360) % 360;
}

/**
 * Format a decimal time (e.g. 14.5) as "2:30 PM"
 * Handles edge cases: 24 wraps to midnight, negative times normalized.
 */
export function formatTime(time: number): string {
	// Normalize to [0, 24) to handle values like 24.0 or negatives
	const normalized = ((time % 24) + 24) % 24;
	const hours = Math.floor(normalized);
	const minutes = Math.floor((normalized % 1) * 60);
	const period = hours >= 12 ? "PM" : "AM";
	const h = hours % 12 || 12;
	return `${h}:${minutes.toString().padStart(2, "0")} ${period}`;
}
