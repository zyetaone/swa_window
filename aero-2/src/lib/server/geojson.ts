/**
 * GeoJSON server endpoint helper — serves city buildings and roads with ETag validation.
 */
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Location } from '#lib/settings/locations.js';

const TILE_DIR = (process.env.TILE_DIR || '/opt/zyeta-aero/tiles').replace(/\/$/, '');

const HEADERS = {
	'content-type': 'application/geo+json',
	'cache-control': 'public, no-cache'
} as const;

async function etagFor(path: string): Promise<string | null> {
	try {
		const s = await stat(path);
		return `W/"${s.size.toString(36)}-${Math.floor(s.mtimeMs).toString(36)}"`;
	} catch {
		return null;
	}
}

function resolveGeojsonPath(city: string, kind: 'buildings' | 'roads'): string | null {
	const filename = `${city}.geojson`;
	const candidates = [
		resolve(TILE_DIR, `../data/${kind}`, filename),
		resolve(process.cwd(), `data/${kind}`, filename),
		resolve(process.cwd(), `../data/${kind}`, filename)
	];

	for (const path of candidates) {
		if (existsSync(path)) return path;
	}
	return null;
}

export async function serveCityGeojson(
	city: string | undefined,
	kind: 'buildings' | 'roads',
	ifNoneMatch?: string | null
): Promise<Response> {
	if (!city || !Location.isValid(city)) {
		return new Response('Unknown city location', { status: 404 });
	}

	const filePath = resolveGeojsonPath(city, kind);
	if (!filePath) {
		// Return empty FeatureCollection gracefully if dataset not packed
		return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
			headers: HEADERS
		});
	}

	const etag = await etagFor(filePath);
	if (etag && ifNoneMatch === etag) {
		return new Response(null, { status: 304, headers: { etag } });
	}

	try {
		const data = await readFile(filePath);
		return new Response(data, {
			headers: {
				...HEADERS,
				...(etag ? { etag } : {})
			}
		});
	} catch {
		return new Response('Failed to read geospatial dataset', { status: 500 });
	}
}
