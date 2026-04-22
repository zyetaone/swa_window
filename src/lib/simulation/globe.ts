/**
 * globe.ts — altitude ↔ zoom + latitude compensation helpers for MapLibre Globe.
 */

const REFERENCE_ALT_M = 9000;
const BASE_ZOOM = 9;

/**
 * Map a camera altitude (meters above sea level) to a MapLibre zoom
 * level.
 */
export function altitudeToZoom(altitudeMeters: number): number {
	const ratio = Math.max(0.05, REFERENCE_ALT_M / Math.max(10, altitudeMeters));
	const z = BASE_ZOOM + Math.log2(ratio);
	return Math.max(3, Math.min(14, z));
}

/**
 * Compensation for globe's latitude-dependent auto-enlargement.
 */
export function latZoomAdjust(oldLatDeg: number, newLatDeg: number): number {
	const a = (oldLatDeg * Math.PI) / 180;
	const b = (newLatDeg * Math.PI) / 180;
	return Math.log2(Math.cos(b) / Math.cos(a));
}
