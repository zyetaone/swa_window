/**
 * Imagery sources — authored data, no logic.
 *
 * SSOT for zoom ranges. In the shipping app these live in two places that
 * disagree: tools/tile-packager/src/sources.ts says [4,12] per source (and
 * matches what is actually on disk), while scripts/prefetch-tiles.ts declares
 * DEFAULT_ZOOMS = [12,13,14,15,16]. Those overlap by exactly one level, so
 * running the second would write tiles nothing reads and skip the ones
 * everything depends on. One list here, and nowhere else.
 *
 * The z12 ceiling is not a preference — it is what the offline packs contain
 * (~36 m/px at this latitude). Asking Cesium for more returns upsampled blur,
 * so near-field sharpness has to come from vector roads and buildings, which
 * are resolution-independent, not from raster imagery.
 */

export interface ImagerySource {
	readonly id: string;
	/** Tile URL template. Local-first; {z}/{x}/{y} substituted at request time. */
	readonly urlTemplate: string;
	/** Inclusive [min, max] zoom actually present in the packs. */
	readonly zoomRange: readonly [number, number];
	/**
	 * Where this source belongs on the day→night axis, 0 day .. 1 night.
	 * Selection picks the source whose anchor is nearest the current
	 * nightFactor.
	 */
	readonly nightAnchor: number;
}

export const IMAGERY_SOURCES: readonly ImagerySource[] = [
	{
		id: 'esri-world-imagery',
		urlTemplate: '/api/tiles/esri-world-imagery/{z}/{x}/{y}.jpg',
		zoomRange: [4, 12],
		nightAnchor: 0,
	},
	{
		id: 'cartodb-dark',
		urlTemplate: '/api/tiles/cartodb-dark/{z}/{x}/{y}.png',
		zoomRange: [4, 12],
		nightAnchor: 1,
	},
];

/**
 * Deadband around the day/night crossover before the base texture swaps.
 *
 * A bare threshold flips back and forth while nightFactor hovers near it, and
 * a base-layer swap is a full tile reload — visible, expensive, and on three
 * panes it would not flip on the same frame.
 */
export const NIGHT_SWAP_HYSTERESIS = 0.08;

/**
 * How far the continuous detail target must move past the current zoom cap
 * before it actually steps.
 *
 * Zoom caps are integers, so without a deadband a slow climb sitting on a
 * boundary retiles the globe repeatedly for no visible gain.
 */
export const DETAIL_STEP_HYSTERESIS = 0.35;
