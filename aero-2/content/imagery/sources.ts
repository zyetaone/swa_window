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
 * Ceilings differ PER SOURCE, which is why the range lives on the source and
 * not in a shared constant. Verified against the packs on disk:
 *   esri-world-imagery  z4-14  (7,467 tiles at z14 alone; ~9 m/px here)
 *   eox-sentinel2       z4-12  — capped by the packager "to keep storage sane"
 *   cartodb-dark        z4-12
 *   viirs-night-lights  z3-8   — every GIBS night layer caps at z8
 *
 * Requesting past a source's ceiling returns upsampled blur, so the cap is a
 * fact about the pack rather than a quality preference. Note the night source
 * bottoms out five levels shallower than the day one: at low altitude the
 * night sky cannot match the day sky for detail no matter what is asked for,
 * and that gap has to be covered by vector roads and lights, which are
 * resolution-independent.
 */

export interface ImagerySource {
	readonly id: string;
	/** Tile URL template. Local-first WMTS {z}/{y}/{x} — matches tile-packager on-disk layout. */
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
		urlTemplate: '/api/tiles/esri-world-imagery/{z}/{y}/{x}.jpg',
		zoomRange: [4, 14],
		nightAnchor: 0,
	},
	{
		id: 'cartodb-dark',
		urlTemplate: '/api/tiles/cartodb-dark/{z}/{y}/{x}.png',
		zoomRange: [4, 12],
		nightAnchor: 1,
	},
];
