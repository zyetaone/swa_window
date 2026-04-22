/**
 * globe-zoom.ts — altitude ↔ zoom + latitude compensation helpers.
 *
 * Two problems under MapLibre's globe projection:
 *
 * 1. Altitude → zoom mapping. The user slides "altitudeMeters" and
 *    expects the globe to feel closer/farther. MapLibre takes a zoom
 *    level, not an altitude. We map them with a log2 curve calibrated
 *    so 9000 m (≈ 30k ft) = zoom 9, which lands a cruise-altitude feel.
 *
 * 2. Latitude compensation. Globe projection automatically enlarges
 *    the map near the poles to stay "consistent with mercator zoom"
 *    at the same zoom level. When our camera drifts latitude (SWA
 *    cruise scenarios fly over many latitudes), the apparent zoom
 *    changes without us asking. The compensation subtracts that.
 *
 * Both helpers are pure — no MapLibre import needed. See:
 * https://maplibre.org/maplibre-gl-js/docs/examples/globe-zoom/
 */

/** Reference altitude at which `zoom = BASE_ZOOM`. Tuned for cruise. */
const REFERENCE_ALT_M = 9000;
const BASE_ZOOM = 9;

/**
 * Map a camera altitude (meters above sea level) to a MapLibre zoom
 * level. Clamped to [3, 14] — below 3 the globe is too small to see
 * detail, above 14 we're past the Sentinel-2 tile ceiling.
 */
export function altitudeToZoom(altitudeMeters: number): number {
	const ratio = Math.max(0.05, REFERENCE_ALT_M / Math.max(10, altitudeMeters));
	const z = BASE_ZOOM + Math.log2(ratio);
	return Math.max(3, Math.min(14, z));
}

/**
 * Compensation for globe's latitude-dependent auto-enlargement.
 * Add this to your target zoom when flying between two latitudes to
 * hold the apparent globe size constant. Verbatim from the MapLibre
 * docs example — `log2(cos(new) / cos(old))`.
 */
export function latZoomAdjust(oldLatDeg: number, newLatDeg: number): number {
	const a = (oldLatDeg * Math.PI) / 180;
	const b = (newLatDeg * Math.PI) / 180;
	return Math.log2(Math.cos(b) / Math.cos(a));
}
