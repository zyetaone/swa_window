/**
 * GET /api/roads/:city → slim GeoJSON of OSM road LineStrings for that
 * city's default radius. Mirrors /api/buildings/:city.
 *
 * Each feature: LineString geometry + `properties.class` (highway tag).
 * Classes restricted to motorway / trunk / primary / secondary /
 * tertiary / residential — enough to build a city skeleton without
 * clutter from service / track / footway.
 *
 * Source: `${TILE_DIR}/../data/roads/:city.geojson` — produced by the
 * tile-packager at build time. Served offline, zero Overpass dependency
 * at runtime. Returns empty collection if not yet packaged.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isValidLocation } from '$content/locations';
import type { RequestHandler } from './$types';

const TILE_DIR = (process.env.TILE_DIR || '/opt/zyeta-aero/tiles').replace(/\/$/, '');
const ROADS_DIR = resolve(TILE_DIR, '..', 'data', 'roads');
const LOCAL_ROADS_DIR = resolve(process.cwd(), 'data', 'roads');

export const GET: RequestHandler = async ({ params }) => {
	const city = params.city;
	if (!isValidLocation(city)) {
		return new Response('Unknown city', { status: 404 });
	}
	const filePath = resolve(ROADS_DIR, `${city}.geojson`);
	const localPath = resolve(LOCAL_ROADS_DIR, `${city}.geojson`);

	try {
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
			const body = await readFile(localPath);
			return new Response(body, {
				status: 200,
				headers: {
					'content-type': 'application/geo+json',
					'cache-control': 'public, max-age=86400',
				},
			});
		} catch {
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
