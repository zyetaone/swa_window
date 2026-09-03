/**
 * Tile template generators, zoom thresholds, attribution and coverage bounding boxes.
 */

export const TILE_SIZE = 256;

export const TILE_MAXZOOM = {
	/**
	 * Sentinel-2 is 10 m and a z14 web-mercator pixel is 9.55 m, so z14 is the
	 * last zoom backed by real source pixels. Packed to z13 today; raising this
	 * beyond 14 only upscales.
	 */
	sentinel2: 13,
	gibs: 9,
	/** VIIRS ships GoogleMapsCompatible_Level8 — there is no z9 to ask for. */
	viirs: 8,
	terrarium: 13
} as const;

/**
 * Below this, Sentinel-2 is not packed and MODIS carries the picture.
 *
 * The packs are per-location boxes, not a global layer: fetching every city at
 * z8-13 is affordable, fetching the planet is not. So the source is mounted
 * with its own minzoom and MapLibre simply requests nothing below it.
 */
export const SENTINEL2_MINZOOM = 8;

/**
 * Both sources are credited because both are drawn: Sentinel-2 over the eleven
 * locations, MODIS everywhere else and under the gaps.
 *
 * The Copernicus notice is not decoration — the licence REQUIRES attribution,
 * and "Contains modified Copernicus Sentinel data" is the exact wording it
 * specifies for data that has been reprojected and retiled, which this has.
 */
export const TILE_ATTRIBUTION =
	'Contains modified Copernicus Sentinel data 2026 · Imagery: NASA EOSDIS GIBS · Elevation: Mapzen / AWS Open Data';

/**
 * The DEM archive URL, under whatever tile origin this pane is configured for.
 *
 * Was a hardcoded `/api/tiles/...` constant, which meant PUBLIC_TILE_SERVER_URL
 * could not move it even once the raster layers honoured it -- so a shared
 * tile-server deployment would have fetched imagery from one host and elevation
 * from another. The prefix is a PARAMETER rather than an env read because this
 * module is pure and unit-tested; `$app/env/public` resolves in components.
 */
export function terrainPmtilesUrl(prefix = '/api/tiles'): string {
	return `pmtiles://${prefix}/terrain.pmtiles`;
}

/** Floor of the packed DEM pyramid. Must match what pack-pmtiles wrote. */
export const TERRAIN_MINZOOM = 5;

export const HILLSHADE_DEFAULT = 0.85;
export const HILLSHADE_SHADOW_COLOR = '#1a2436';
/**
 * Terrain at its real height. 1.0 is not a tuning choice, it is the datum.
 *
 * 2.5x was compensating for something else: GIBS at z9 is ~250 m/px, so relief
 * was invisible in the imagery and the mesh was pushed to make it legible. That
 * traded a texture problem for a geometry lie -- Everest was drawn at 22,122 m,
 * three times higher than any airliner flies, and every camera altitude had to
 * be scaled to match or the window filled with hillside.
 *
 * The honest fix for flat-looking ground is sharper ground (Sentinel-2 at z14
 * is ~9.5 m/px) and hillshade, not a taller planet. At 1.0 the drawn surface
 * and the flight envelope finally use the same units, which is what makes an
 * altitude in the HUD mean anything.
 */
export const TERRAIN_EXAGGERATION = 1.0;

export const IMAGERY_GRADE = {
	saturation: -0.08,
	contrast: 0.06,
	resampling: 'linear' as const,
	fadeDuration: 0
};

export function tileTemplates(prefix = '/api/tiles'): {
	sentinel2: string[];
	gibs: string[];
	viirs: string[];
	terrarium: string[];
} {
	return {
		sentinel2: [`${prefix}/xyz/sentinel2/{z}/{x}/{y}.jpg`],
		gibs: [`${prefix}/xyz/gibs/{z}/{x}/{y}.jpg`],
		viirs: [`${prefix}/xyz/viirs/{z}/{x}/{y}.png`],
		terrarium: [`${prefix}/xyz/terrarium/{z}/{x}/{y}.png`]
	};
}
