import {
	GIBS_DATE,
	parseRange,
	remoteFallbackEnabled,
	remoteTileUrl,
	resolveTileDir,
	resolveTileHealth
} from '#lib/server/tiles.js';
import { terrainPmtilesUrl } from '#lib/settings/tiles.js';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GET as TILES_GET } from '../src/routes/api/tiles/[...path]/+server.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CWD = '/srv/aero';

describe('resolveTileDir', () => {
	it('returns an absolute TILE_DIR unchanged (fast path)', () => {
		expect(resolveTileDir({ TILE_DIR: '/opt/custom/tiles' }, CWD, () => false)).toBe(
			'/opt/custom/tiles'
		);
	});

	it('resolves a relative TILE_DIR against cwd', () => {
		expect(resolveTileDir({ TILE_DIR: 'data/tiles' }, CWD, () => false)).toBe(`${CWD}/data/tiles`);
	});

	it('picks the Pi install path when it exists', () => {
		expect(resolveTileDir({}, CWD, (p) => p === '/opt/zyeta-aero/tiles')).toBe(
			'/opt/zyeta-aero/tiles'
		);
	});

	it('falls back to local data/tiles when it has layer subdirectories', () => {
		const local = `${CWD}/data/tiles`;
		expect(
			resolveTileDir(
				{},
				CWD,
				() => false,
				(dir) => dir === local
			)
		).toBe(local);
	});

	it('falls back to parent ../data/tiles when it has content and local does not', () => {
		const parent = resolve(CWD, '../data/tiles');
		expect(
			resolveTileDir(
				{},
				CWD,
				() => false,
				(dir) => dir === parent
			)
		).toBe(parent);
	});

	it('defaults to local data/tiles when nothing exists yet', () => {
		expect(
			resolveTileDir(
				{},
				CWD,
				() => false,
				() => false
			)
		).toBe(`${CWD}/data/tiles`);
	});
});

describe('resolveTileHealth', () => {
	/**
	 * Every case here is the same failure wearing a different hat: an archive
	 * that is present but cannot draw the world, reported as healthy.
	 *
	 * The version this replaces answered `{status:'ok', hasTiles:true}` for a
	 * directory containing nothing but `terrarium/` — build INPUT the kiosk
	 * never requests — while every ground tile 404'd and the window rendered a
	 * white sheet. It was structurally unable to say otherwise: it asked
	 * whether any subdirectory was non-empty. So the first test below is the
	 * exact archive this repo shipped on 2026-09-03.
	 *
	 * `AERO_TILE_REMOTE_FALLBACK: '0'` on every case, because the answer is
	 * about the ARCHIVE. Without pinning it, an env that happens to say
	 * `development` turns every `error` into `degraded` and the suite passes
	 * for a reason that has nothing to do with what it is testing.
	 */
	const OFFLINE = { AERO_TILE_REMOTE_FALLBACK: '0' };

	function pack(assets: { dirs?: string[]; files?: [string, string][] }): string {
		const root = mkdtempSync(join(tmpdir(), 'aero-test-health-'));
		for (const d of assets.dirs ?? []) {
			mkdirSync(join(root, d, '5', '10'), { recursive: true });
			writeFileSync(join(root, d, '5', '10', '20.png'), 'tile');
		}
		for (const [name, body] of assets.files ?? []) writeFileSync(join(root, name), body);
		return root;
	}

	it('reports error for the terrarium-only pack that shipped as ok', () => {
		const h = resolveTileHealth(pack({ dirs: ['terrarium'] }), OFFLINE);
		expect(h.status).toBe('error');
		expect(h.hasTiles).toBe(false);
		expect(h.missing).toContain('gibs');
		expect(h.missing).toContain('terrain.pmtiles');
		// The old signal said this archive was fine BECAUSE this list is non-empty.
		expect(h.layers).toEqual(['terrarium']);
	});

	it('reports ok for a complete pack', () => {
		const h = resolveTileHealth(
			pack({
				dirs: ['gibs', 'viirs', 'sentinel2', 'water'],
				files: [['terrain.pmtiles', 'PMTiles-body']]
			}),
			OFFLINE
		);
		expect(h.status).toBe('ok');
		expect(h.hasTiles).toBe(true);
		expect(h.missing).toEqual([]);
	});

	it('reports degraded, not error, when only the night lights are absent', () => {
		// viirs adds city lights after dark. Missing, the window is dimmer at
		// night and correct all day, which is not the same emergency as no
		// ground at all — and the old single boolean could not say so.
		const h = resolveTileHealth(
			pack({ dirs: ['gibs', 'sentinel2', 'water'], files: [['terrain.pmtiles', 'PMTiles-body']] }),
			OFFLINE
		);
		expect(h.status).toBe('degraded');
		expect(h.hasTiles).toBe(true);
		expect(h.missing).toEqual(['viirs']);
	});

	it('treats an empty layer directory and a zero-byte archive as absent', () => {
		// Both exist. Both draw nothing. `existsSync` would call this healthy,
		// which is the same class of mistake as counting directories.
		const root = pack({ files: [['terrain.pmtiles', '']] });
		mkdirSync(join(root, 'gibs'), { recursive: true });
		const h = resolveTileHealth(root, OFFLINE);
		expect(h.status).toBe('error');
		expect(h.missing).toContain('gibs');
		expect(h.missing).toContain('terrain.pmtiles');
	});

	it('reports error, not a throw, when TILE_DIR does not exist at all', () => {
		const h = resolveTileHealth('/definitely/not/a/tile/dir', OFFLINE);
		expect(h.status).toBe('error');
		expect(h.layers).toEqual([]);
	});

	/**
	 * Dead weight is invisible unless something counts it.
	 *
	 * The pack carried 2.7 GB of raw Sentinel GeoTIFFs (`_s2-hyderabad`, left
	 * by an abandoned warp) that nothing requests, and the health readout
	 * listed it as a `layer` — presenting half a spare gigabyte-scale directory
	 * as an asset. `terrarium` is deliberately NOT flagged: it is build input
	 * `pack-pmtiles` reads to produce the DEM, so it is unused by the kiosk and
	 * still wanted on the machine that repacks.
	 */
	it('names directories the kiosk never requests, without flagging build input', () => {
		const root = pack({
			dirs: ['gibs', 'viirs', 'sentinel2', 'water', 'terrarium', '_s2-hyderabad'],
			files: [['terrain.pmtiles', 'PMTiles-body']]
		});
		const h = resolveTileHealth(root, OFFLINE);
		expect(h.status).toBe('ok');
		expect(h.unused.map((u) => u.name)).toEqual(['_s2-hyderabad']);
	});

	it('reports no dead weight for a clean pack', () => {
		const h = resolveTileHealth(
			pack({
				dirs: ['gibs', 'viirs', 'sentinel2', 'water'],
				files: [['terrain.pmtiles', 'PMTiles-body']]
			}),
			OFFLINE
		);
		expect(h.unused).toEqual([]);
	});

	it('softens to degraded when the dev remote fallback can cover the gap', () => {
		// On a workstation proxying GIBS the world draws correctly, so `error`
		// would be a false alarm on the one machine where nothing is wrong.
		// The Pi runs with the fallback off and still gets `error`.
		const empty = pack({});
		expect(resolveTileHealth(empty, { AERO_TILE_REMOTE_FALLBACK: '1' }).status).toBe('degraded');
		expect(resolveTileHealth(empty, OFFLINE).status).toBe('error');
	});
});

describe('remoteFallbackEnabled', () => {
	it('forces off when AERO_TILE_REMOTE_FALLBACK=0', () => {
		expect(remoteFallbackEnabled({ AERO_TILE_REMOTE_FALLBACK: '0', NODE_ENV: 'development' })).toBe(
			false
		);
	});

	it('forces on when AERO_TILE_REMOTE_FALLBACK=1', () => {
		expect(remoteFallbackEnabled({ AERO_TILE_REMOTE_FALLBACK: '1', NODE_ENV: 'production' })).toBe(
			true
		);
	});

	it('defaults to true in development', () => {
		expect(remoteFallbackEnabled({ NODE_ENV: 'development' })).toBe(true);
	});

	it('fails closed in production or when NODE_ENV is unset', () => {
		expect(remoteFallbackEnabled({ NODE_ENV: 'production' })).toBe(false);
		expect(remoteFallbackEnabled({})).toBe(false);
	});
});

describe('remoteTileUrl', () => {
	it('maps terrarium paths to elevation-tiles-prod', () => {
		expect(remoteTileUrl('terrarium/5/10/20.png')).toBe(
			'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/20/10.png'
		);
	});

	it('maps gibs paths to NASA EOSDIS Level9 true color', () => {
		expect(remoteTileUrl('gibs/5/10/20.jpg')).toBe(
			`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${GIBS_DATE}/GoogleMapsCompatible_Level9/5/10/20.jpg`
		);
	});

	/**
	 * The date must be a real day, never `default`. `default` means "today", so
	 * it shows live weather (99.5% cloud over Hyderabad in August), can return
	 * no tile at all on some days, and makes three Pis disagree across the
	 * panorama seam when they boot either side of the GIBS daily update.
	 *
	 * Asserted on the URL rather than the constant, so re-inlining the literal
	 * cannot quietly bypass it.
	 */
	it('pins the gibs imagery to a fixed day, not `default`', () => {
		const url = remoteTileUrl('gibs/5/10/20.jpg') ?? '';
		expect(url).toMatch(/\/default\/\d{4}-\d{2}-\d{2}\//);
		expect(url).not.toMatch(/\/default\/default\//);
	});

	it('returns null for unknown layers or invalid tile paths', () => {
		expect(remoteTileUrl('unknown/5/10/20.jpg')).toBeNull();
		// usgs was a real layer until the NAIP detail layer was deleted.
		expect(remoteTileUrl('usgs/12/100/200.jpg')).toBeNull();
		expect(remoteTileUrl('not-a-tile-path')).toBeNull();
	});
});

describe('parseRange (PMTiles Range Requests)', () => {
	const SIZE = 1000;

	it('parses standard range bytes=0-499', () => {
		expect(parseRange('bytes=0-499', SIZE)).toEqual({ start: 0, end: 499 });
	});

	it('parses open-ended range bytes=500-', () => {
		expect(parseRange('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 });
	});

	it('parses suffix range bytes=-200 (last 200 bytes)', () => {
		expect(parseRange('bytes=-200', SIZE)).toEqual({ start: 800, end: 999 });
	});

	it('returns null for null, empty or invalid headers', () => {
		expect(parseRange(null, SIZE)).toBeNull();
		expect(parseRange('', SIZE)).toBeNull();
		expect(parseRange('invalid', SIZE)).toBeNull();
	});

	it('returns unsatisfiable when start >= size', () => {
		expect(parseRange('bytes=1000-1200', SIZE)).toBe('unsatisfiable');
	});

	it('returns unsatisfiable when suffix <= 0', () => {
		expect(parseRange('bytes=-0', SIZE)).toBe('unsatisfiable');
	});

	/**
	 * A zero-length file satisfies no range. The suffix branch returned early,
	 * before the `end < start` check, so `bytes=-100` against an empty file came
	 * back as `{ start: 0, end: -1 }` — which the route serves as
	 * `Content-Range: bytes 0--1/0` with a read stream ending before it starts.
	 */
	it('returns unsatisfiable for any range against a zero-length file', () => {
		expect(parseRange('bytes=-100', 0)).toBe('unsatisfiable');
		expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
		expect(parseRange('bytes=0-99', 0)).toBe('unsatisfiable');
	});
});

describe('cache headers', () => {
	/**
	 * These read the REAL archive, and `data/` is gitignored.
	 *
	 * Without this guard the four assertions below fail with `expected 404 to
	 * be 200` on any machine that has not built the tile pack — which is every
	 * CI runner, and CI is what gates the `release` branch the fleet updater
	 * tracks. A test that is red on a clean checkout does not protect anything;
	 * it just teaches people that red is normal.
	 *
	 * Skipped rather than rewritten against a temp fixture on purpose: what
	 * these check is the cache-control and etag behaviour of the code path that
	 * streams a multi-gigabyte PMTiles archive over byte ranges, and a
	 * synthetic stand-in would exercise a different branch than the one that
	 * matters. Same trade the DEM checks in integration.test.ts make.
	 */
	const ARCHIVE = resolve(resolveTileDir(), 'terrain.pmtiles');
	const packed = existsSync(ARCHIVE);

	const req = (path: string, headers: Record<string, string> = {}) =>
		TILES_GET({
			params: { path },
			request: new Request('http://x/' + path, { headers })
		} as never);

	/**
	 * A raster tile at z/x/y IS its own address: re-packing changes the tiles, not
	 * what a URL means, so a year of `immutable` is right for those.
	 *
	 * A PMTiles archive is the opposite — one URL, 3.7 GB behind it, re-packed
	 * whenever the DEM is rebuilt, and read through hundreds of byte ranges. A
	 * stale copy is not a stale picture, it is a stale DIRECTORY pointing at
	 * offsets that no longer mean what they meant. `immutable` told every fielded
	 * Pi to keep that for a year, so a re-packed DEM could not reach the wall
	 * without someone clearing a browser cache by hand.
	 */

	it.skipIf(!packed)('raster tiles are immutable', async () => {
		const r = await req('xyz/terrarium/9/361/226.png');
		expect(r.status).toBe(200);
		expect(r.headers.get('cache-control')).toContain('immutable');
		expect(r.headers.get('etag')).toBeNull();
	});

	it.skipIf(!packed)('pmtiles archives revalidate and carry an etag', async () => {
		const r = await req('terrain.pmtiles', { Range: 'bytes=0-127' });
		expect(r.status).toBe(206);
		expect(r.headers.get('cache-control')).toBe('public, no-cache');
		expect(r.headers.get('etag')).toMatch(/^W\//);
	});

	it.skipIf(!packed)('a matching etag on the whole file gives 304', async () => {
		const first = await req('terrain.pmtiles');
		const etag = first.headers.get('etag')!;
		await first.body?.cancel();
		const second = await req('terrain.pmtiles', { 'If-None-Match': etag });
		expect(second.status).toBe(304);
	});

	it.skipIf(!packed)('a range request is never answered with 304', async () => {
		const first = await req('terrain.pmtiles');
		const etag = first.headers.get('etag')!;
		await first.body?.cancel();
		const ranged = await req('terrain.pmtiles', { 'If-None-Match': etag, Range: 'bytes=0-127' });
		expect(ranged.status).toBe(206);
	});
});

/**
 * The archive has to follow the same origin as the raster layers. It was a
 * hardcoded constant, so a shared-tile-server pane would have pulled imagery
 * from a peer and elevation from itself.
 */
describe('terrainPmtilesUrl', () => {
	it('follows the configured tile origin', () => {
		expect(terrainPmtilesUrl('/api/tiles')).toBe('pmtiles:///api/tiles/terrain.pmtiles');
		expect(terrainPmtilesUrl('http://aero-1.local:3000/api/tiles')).toBe(
			'pmtiles://http://aero-1.local:3000/api/tiles/terrain.pmtiles'
		);
	});
});
