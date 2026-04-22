/**
 * GET /api/buildings/:city → slim extrusion-ready GeoJSON for OSM buildings
 * within that city's default radius.
 *
 * Source: `${TILE_DIR}/../data/buildings/:city.geojson` — produced by the
 * tile-packager at build time. Served offline, zero Overpass dependency
 * at runtime. 404 if not yet packaged (caller falls back to flat terrain).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LOCATION_MAP } from '$lib/locations';
import type { RequestHandler } from './$types';

const TILE_DIR = (process.env.TILE_DIR || '/opt/zyeta-aero/tiles').replace(/\/$/, '');
const BUILDINGS_DIR = resolve(TILE_DIR, '..', 'data', 'buildings');
// Fallback for local development on Mac
const LOCAL_BUILDINGS_DIR = resolve(process.cwd(), 'data', 'buildings');


export const GET: RequestHandler = async ({ params }) => {
	const city = params.city;
	if (!city || !LOCATION_MAP.has(city as never)) {
		return new Response('Unknown city', { status: 404 });
	}
	const filePath = resolve(BUILDINGS_DIR, `${city}.geojson`);
	const localPath = resolve(LOCAL_BUILDINGS_DIR, `${city}.geojson`);

	try {
		// Priority 1: Production/Configured path
		const body = await readFile(filePath);
		return new Response(body, {
			status: 200,
			headers: {
				'content-type': 'application/geo+json',
				'cache-control': 'public, max-age=86400',
			},
		});
	} catch {
		try {
			// Priority 2: Local workspace fallback
			const body = await readFile(localPath);
			return new Response(body, {
				status: 200,
				headers: {
					'content-type': 'application/geo+json',
					'cache-control': 'public, max-age=86400',
				},
			});
		} catch {
			// Priority 3: Return empty collection to clear console 404 errors
			return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
				status: 200,
				headers: {
					'content-type': 'application/geo+json',
					'cache-control': 'public, max-age=60',
				},
			});
		}
	}
};
