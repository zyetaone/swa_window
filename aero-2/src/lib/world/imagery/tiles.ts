/**
 * What the ground is made of, client-side: the three tile templates and the
 * one coverage rule that decides whether the detail layer is worth asking for.
 *
 * Every template points at `/api/tiles`, never at an upstream host — a local
 * pack is used when one exists, and `server/tiles.ts` is the ONLY place any
 * real origin is named. Pointing the client straight at AWS/NASA/USGS is how
 * this quietly opted out of the offline promise once already: no local pack was
 * ever consulted, and a kiosk with no route out failed instead of falling back.
 */

import { PUBLIC_TILE_SERVER_URL } from '$app/env/public';
import type { Location } from '#lib/world/locations.js';

export interface TileTemplates {
	/** Elevation. MapLibre decodes terrarium natively, so one fetch drives both
	 *  the displaced mesh and the hillshade. */
	readonly terrarium: string[];
	/** Base colour. Public domain, and never has a hole in it, anywhere. */
	readonly gibs: string[];
	/** Detail colour. Public domain, US-only. */
	readonly usgs: string[];
}

export function tileTemplates(): TileTemplates {
	// Default and trailing-slash trim live in the schema (src/env.ts), so there
	// is no second place to get them wrong.
	const base = PUBLIC_TILE_SERVER_URL;
	return {
		terrarium: [`${base}/xyz/terrarium/{z}/{x}/{y}.png`],
		gibs: [`${base}/xyz/gibs/{z}/{x}/{y}.jpg`],
		usgs: [`${base}/xyz/usgs/{z}/{x}/{y}.jpg`]
	};
}

/** Max zoom each source actually has data for. Asking past this streams 404s. */
export const TILE_MAXZOOM = {
	/** GIBS' Level9 grid tops out here — z9 is ~306 m/px. */
	gibs: 9,
	/** NAIP, ~2.4 m/px. */
	usgs: 16,
	terrarium: 13
} as const;

export const TILE_SIZE = 256;

export const TILE_ATTRIBUTION =
	'Imagery: NASA EOSDIS GIBS, USGS The National Map · Elevation: Mapzen / AWS Open Data';

/**
 * NAIP is a US federal work and covers the US only, so anywhere else would just
 * stream 404s. A bounding box rather than a coverage API — ponytail: wrong for
 * Alaska and Hawaii, and that is fine until a location lands there.
 */
export function inNaipCoverage(place: Pick<Location, 'lat' | 'lon'>): boolean {
	return place.lat > 24 && place.lat < 50 && place.lon > -125 && place.lon < -66;
}
