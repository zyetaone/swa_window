/**
 * Imagery URLs, coverage bounds, and tile templates.
 */

export const TILE_SIZE = 256;

// esri (World Imagery) was tried and reverted: it's proprietary commercial
// imagery, not public domain — bulk-downloading it into an offline pack for a
// fielded kiosk is outside what the free endpoint's terms allow. GIBS is US
// government public domain, unambiguously fine to cache in bulk. It shows
// real daily cloud cover (it's an actual satellite capture, not a cloud-free
// composite); fixing that needs a baked Sentinel-2 composite, not a swap.
export const TILE_MAXZOOM = {
	gibs: 9,
	usgs: 16,
	terrarium: 13
} as const;

export const TILE_ATTRIBUTION =
	'Imagery: NASA EOSDIS GIBS, USGS The National Map · Elevation: Mapzen / AWS Open Data';

/**
 * The elevation pack — ONE archive covering every location, not one per place.
 *
 * The fleet rotates through locations, so a Pi needs all of them anyway; a pack
 * per place would put the same bytes on the same SD card and add a lookup to
 * choose between them. One file, one URL, no selection logic.
 *
 * Served through `/api/tiles` (which answers Range requests) rather than from
 * `static/`, so the archive is not copied into the build.
 */
export const TERRAIN_PMTILES = 'pmtiles:///api/tiles/terrain.pmtiles';

export function inNaipCoverage(loc: { lat: number; lon: number }): boolean {
	return loc.lat >= 24.5 && loc.lat <= 49.5 && loc.lon >= -125.0 && loc.lon <= -66.9;
}

/**
 * Tile templates, pointed at the local tile server rather than any upstream
 * host — a local pack is used when one exists, and `server/tiles.ts` is the
 * ONLY place a real origin is named.
 *
 * The `xyz/` segment and the file extension are BOTH load-bearing: the route
 * matches `xyz/{layer}/{z}/{x}/{y}.{ext}` and uses that to flip x/y into the
 * WMTS layout used on disk. Drop either and EVERY tile 404s — verified against
 * a running server, not assumed.
 */
export function tileTemplates(prefix = '/api/tiles'): {
	gibs: string[];
	usgs: string[];
	terrarium: string[];
} {
	return {
		gibs: [`${prefix}/xyz/gibs/{z}/{x}/{y}.jpg`],
		usgs: [`${prefix}/xyz/usgs/{z}/{x}/{y}.jpg`],
		terrarium: [`${prefix}/xyz/terrarium/{z}/{x}/{y}.png`]
	};
}
