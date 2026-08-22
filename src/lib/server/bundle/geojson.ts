/**
 * Shared handler for the two per-city GeoJSON routes (/api/buildings/:city,
 * /api/roads/:city) — they were byte-identical modulo the data subdir.
 *
 * 3-tier read: `${TILE_DIR}/../data/<kind>` (packaged, production Pi) →
 * `cwd()/data/<kind>` (local dev fallback) → empty FeatureCollection
 * (clears console 404s; callers degrade gracefully). Files are produced by
 * tools/tile-packager at build time — zero Overpass dependency at runtime.
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isValidLocation } from '$content/locations';

const TILE_DIR = (process.env.TILE_DIR || '/opt/zyeta-aero/tiles').replace(/\/$/, '');

/**
 * ⚠ `no-cache` + ETag. NOT `max-age`, and NOT `must-revalidate` either.
 *
 * These files are packager OUTPUT and they DO change — a road re-extract
 * rewrote all eight cities. `git pull` is the deploy mechanism, so the new
 * bytes land on the Pi, but a browser holding a 24-hour `max-age` (and the
 * loader used `cache: 'force-cache'`, which returns a stale entry regardless)
 * keeps rendering the OLD grid until the entry is evicted. On a kiosk that
 * never navigates away, that is effectively forever: the wall silently shows
 * last week's city and nothing errors.
 *
 * `must-revalidate` is NOT the fix and was tried first: it only forces
 * revalidation once an entry is STALE, so paired with `max-age=86400` the
 * browser still serves 24-hour-old geometry without ever asking. Caught by
 * measurement — the server was returning 3,447 features while the page kept
 * rendering 21,781, through a hard reload.
 *
 * `no-cache` means "you may store this, but revalidate every time". With the
 * ETag the common case is a conditional request answered 304 with no body, and
 * this is a same-origin call to a server on the same box, so the round trip is
 * free while the correctness is absolute. `no-cache` is not `no-store`.
 */
const HEADERS = {
	'content-type': 'application/geo+json',
	'cache-control': 'public, no-cache',
} as const;

/** Weak validator from size + mtime — no need to hash 5 MB on every request. */
async function etagFor(path: string): Promise<string | null> {
	try {
		const s = await stat(path);
		return `W/"${s.size.toString(36)}-${Math.floor(s.mtimeMs).toString(36)}"`;
	} catch {
		return null;
	}
}

export async function serveCityGeojson(
	city: string | undefined,
	kind: 'buildings' | 'roads',
	ifNoneMatch?: string | null,
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
			const body = await readFile(path);
			const etag = await etagFor(path);
			const headers = etag ? { ...HEADERS, etag } : HEADERS;
			// A matching validator means the client already has these exact bytes;
			// answer 304 rather than re-sending ~5 MB.
			if (etag && ifNoneMatch === etag) {
				return new Response(null, { status: 304, headers });
			}
			return new Response(body, { status: 200, headers });
		} catch {
			// try next tier
		}
	}
	return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
		status: 200,
		headers: { ...HEADERS, 'cache-control': 'public, max-age=60' },
	});
}
