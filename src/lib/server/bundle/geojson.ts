/**
 * Shared handler for the two per-city GeoJSON routes (/api/buildings/:city,
 * /api/roads/:city) — they were byte-identical modulo the data subdir.
 *
 * 3-tier read: `${TILE_DIR}/../data/<kind>` (packaged, production Pi) →
 * `cwd()/data/<kind>` (local dev fallback) → empty FeatureCollection
 * (clears console 404s; callers degrade gracefully). Files are produced by
 * tools/tile-packager at build time — zero Overpass dependency at runtime.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isValidLocation } from '$content/locations';

const TILE_DIR = (process.env.TILE_DIR || '/opt/zyeta-aero/tiles').replace(/\/$/, '');

const HEADERS = {
	'content-type': 'application/geo+json',
	'cache-control': 'public, max-age=86400',
} as const;

export async function serveCityGeojson(
	city: string | undefined,
	kind: 'buildings' | 'roads',
): Promise<Response> {
	if (!isValidLocation(city)) {
		return new Response('Unknown city', { status: 404 });
	}
	const paths = [
		resolve(TILE_DIR, '..', 'data', kind, `${city}.geojson`),
		resolve(process.cwd(), 'data', kind, `${city}.geojson`),
	];
	for (const path of paths) {
		try {
			return new Response(await readFile(path), { status: 200, headers: HEADERS });
		} catch {
			// try next tier
		}
	}
	return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
		status: 200,
		headers: { ...HEADERS, 'cache-control': 'public, max-age=60' },
	});
}
