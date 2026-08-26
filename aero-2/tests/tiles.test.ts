import {
	GIBS_DATE,
	parseRange,
	remoteFallbackEnabled,
	remoteTileUrl,
	resolveLocalTile,
	resolveTileDir
} from '#lib/server/tiles.js';
import { groundDetailOpacity } from '#lib/settings/tiles.js';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CWD = '/srv/aero';

describe('resolveTileDir', () => {
	it('returns an absolute TILE_DIR unchanged (fast path)', () => {
		expect(resolveTileDir({ TILE_DIR: '/opt/custom/tiles' }, CWD, () => false)).toBe(
			'/opt/custom/tiles'
		);
	});

	it('resolves a relative TILE_DIR against cwd', () => {
		expect(resolveTileDir({ TILE_DIR: 'static/tiles' }, CWD, () => false)).toBe(`${CWD}/static/tiles`);
	});

	it('picks the Pi install path when it exists', () => {
		expect(resolveTileDir({}, CWD, (p) => p === '/opt/zyeta-aero/tiles')).toBe(
			'/opt/zyeta-aero/tiles'
		);
	});

	it('falls back to local static/tiles when it has layer subdirectories', () => {
		const local = `${CWD}/static/tiles`;
		expect(
			resolveTileDir(
				{},
				CWD,
				() => false,
				(dir) => dir === local
			)
		).toBe(local);
	});

	it('falls back to parent ../static/tiles when it has content and local does not', () => {
		const parent = resolve(CWD, '../static/tiles');
		expect(
			resolveTileDir(
				{},
				CWD,
				() => false,
				(dir) => dir === parent
			)
		).toBe(parent);
	});

	it('defaults to local static/tiles when nothing exists yet', () => {
		expect(
			resolveTileDir(
				{},
				CWD,
				() => false,
				() => false
			)
		).toBe(`${CWD}/static/tiles`);
	});
});

describe('resolveLocalTile - path guard', () => {
	let sandbox: string;

	beforeEach(() => {
		sandbox = mkdtempSync(join(tmpdir(), 'aero-test-tiles-'));
		mkdirSync(join(sandbox, 'gibs', '5', '10'), { recursive: true });
		writeFileSync(join(sandbox, 'gibs', '5', '10', '20.jpg'), 'fake-jpeg');
	});

	afterEach(() => {
		// cleanup temp dir
	});

	it('resolves an existing file inside root', () => {
		const res = resolveLocalTile(sandbox, 'gibs/5/10/20.jpg');
		expect(res.notFound).toBe(false);
		expect(res.forbidden).toBe(false);
		expect(res.filePath).toBe(join(sandbox, 'gibs/5/10/20.jpg'));
	});

	it('flags a missing file as notFound (not forbidden)', () => {
		const res = resolveLocalTile(sandbox, 'gibs/5/10/999.jpg');
		expect(res.notFound).toBe(true);
		expect(res.forbidden).toBe(false);
	});

	it('rejects directory traversal (../)', () => {
		const res = resolveLocalTile(sandbox, '../../../etc/passwd');
		expect(res.forbidden).toBe(true);
	});

	it('rejects absolute paths escaping root', () => {
		const res = resolveLocalTile(sandbox, '/etc/passwd');
		expect(res.forbidden).toBe(true);
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

	it('maps usgs paths to USGS ImageryOnly MapServer', () => {
		expect(remoteTileUrl('usgs/12/100/200.jpg')).toBe(
			'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/12/100/200'
		);
	});

	it('returns null for unknown layers or invalid tile paths', () => {
		expect(remoteTileUrl('unknown/5/10/20.jpg')).toBeNull();
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
});

/**
 * The detail layer is NAIP: a daylight aerial photograph, mounted above the
 * VIIRS city lights because MapLibre stacks rasters in mount order and it
 * mounted last. At `raster-opacity: 1` it hid the lights outright — every US
 * location rendered local 02:00 as broad daylight. Verified in Chicago at
 * 02:05 with the night curve at -31 degrees and not one light visible.
 */
describe('groundDetailOpacity', () => {
	it('hides the daylight photograph once it is dark', () => {
		expect(groundDetailOpacity(1, 1)).toBe(0);
	});

	it('shows it in full daylight where there is coverage', () => {
		expect(groundDetailOpacity(1, 0)).toBe(1);
	});

	it('stays hidden where there is no coverage, at any hour', () => {
		for (const night of [0, 0.25, 0.5, 0.75, 1]) expect(groundDetailOpacity(0, night)).toBe(0);
	});

	it('falls monotonically as night comes on, so there is no pop', () => {
		let last = Infinity;
		for (let night = 0; night <= 1; night += 0.1) {
			const now = groundDetailOpacity(1, night);
			expect(now).toBeLessThanOrEqual(last);
			last = now;
		}
	});
});
