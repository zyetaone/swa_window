/**
 * Tile template generators, zoom thresholds, attribution and coverage bounding boxes.
 */

export const TILE_SIZE = 256;

export const TILE_MAXZOOM = {
	gibs: 9,
	/** VIIRS ships GoogleMapsCompatible_Level8 — there is no z9 to ask for. */
	viirs: 8,
	usgs: 16,
	terrarium: 13
} as const;

export const TILE_ATTRIBUTION =
	'Imagery: NASA EOSDIS GIBS, USGS The National Map · Elevation: Mapzen / AWS Open Data';

export const TERRAIN_PMTILES = 'pmtiles:///api/tiles/terrain.pmtiles';

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

/**
 * How strongly the high-resolution detail imagery shows, 0-1.
 *
 * NAIP is a daylight aerial photograph. It was drawn at full opacity ABOVE the
 * VIIRS city lights, so every US location rendered local 02:00 as broad
 * daylight with no lights at all — MapLibre stacks raster layers in mount
 * order, and that layer mounted last.
 *
 * Fading it on daylight is the physical answer and also removes the ordering
 * dependency: once it is gone, the lights are the only layer above the base.
 */
export function groundDetailOpacity(detail: number, night: number): number {
	return Math.max(0, Math.min(1, detail)) * (1 - Math.max(0, Math.min(1, night)));
}

export const IMAGERY_GRADE = {
	saturation: -0.08,
	contrast: 0.06,
	resampling: 'linear' as const,
	fadeDuration: 0
};

export function inNaipCoverage(loc: { lat: number; lon: number }): boolean {
	return loc.lat >= 24.5 && loc.lat <= 49.5 && loc.lon >= -125.0 && loc.lon <= -66.9;
}

export function tileTemplates(prefix = '/api/tiles'): {
	gibs: string[];
	viirs: string[];
	usgs: string[];
	terrarium: string[];
} {
	return {
		gibs: [`${prefix}/xyz/gibs/{z}/{x}/{y}.jpg`],
		viirs: [`${prefix}/xyz/viirs/{z}/{x}/{y}.png`],
		usgs: [`${prefix}/xyz/usgs/{z}/{x}/{y}.jpg`],
		terrarium: [`${prefix}/xyz/terrarium/{z}/{x}/{y}.png`]
	};
}
