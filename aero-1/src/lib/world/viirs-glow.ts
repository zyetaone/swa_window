/**
 * VIIRS luminance → night glow scale — shared by vector roads at runtime and
 * the optional `viirs-roads` tile bake (tools/tile-packager).
 *
 * `floor + (1 − floor) · luminance` keeps sparse suburbs dim but visible while
 * downtown cores bloom — the same curve the raster composite used, now applied
 * per polyline via viirs-field sampling instead of a baked imagery layer.
 */

/** Minimum road-lamp brightness where VIIRS is dark (matches packager default). */
export const VIIRS_ROAD_GLOW_FLOOR = 0.15;

export function luma601(r: number, g: number, b: number): number {
	return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Road-glow multiplier for a VIIRS luminance sample (0–255).
 *
 * Linear remap lum ∈ [0,255] → factor ∈ [floor, 1]. Preserves intra-city
 * gradient across the whole range while guaranteeing a floor in sparse towns.
 */
export function glowFactor(luminance: number, floor: number): number {
	const lum = Math.min(255, Math.max(0, luminance)) / 255;
	return floor + (1 - floor) * lum;
}

/** VIIRS field sample 0..1 → road lamp scale [floor, 1]. */
export function viirsRoadGlowScale(luminance01: number, floor = VIIRS_ROAD_GLOW_FLOOR): number {
	return glowFactor(luminance01 * 255, floor);
}

/** Quantize a glow scale into buckets so bins share one Material uniform. */
export const VIIRS_GLOW_BUCKETS = 8;

export function viirsGlowBucketIndex(scale: number, floor = VIIRS_ROAD_GLOW_FLOOR): number {
	const span = 1 - floor;
	if (span <= 0) return 0;
	const t = (scale - floor) / span;
	return Math.min(VIIRS_GLOW_BUCKETS - 1, Math.max(0, Math.floor(t * VIIRS_GLOW_BUCKETS)));
}

/** Bucket centre — stable scale written once per bin at load time. */
export function viirsGlowBucketCenter(index: number, floor = VIIRS_ROAD_GLOW_FLOOR): number {
	const t = (index + 0.5) / VIIRS_GLOW_BUCKETS;
	return floor + (1 - floor) * t;
}
