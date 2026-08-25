import {
	remoteFallbackEnabled,
	remoteTileUrl,
	resolveLocalTile,
	resolveTileDir,
} from '#lib/server/tiles.js';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CWD = '/srv/aero';

describe('resolveTileDir', () => {
	it('returns an absolute TILE_DIR unchanged (fast path)', () => {
		expect(resolveTileDir({ TILE_DIR: '/opt/custom/tiles' }, CWD, () => false)).toBe(
			'/opt/custom/tiles',
		);
	});

	it('resolves a relative TILE_DIR against cwd', () => {
		expect(resolveTileDir({ TILE_DIR: 'data/tiles' }, CWD, () => false)).toBe(
			`${CWD}/data/tiles`,
		);
	});

	it('prefers Pi path when it exists and TILE_DIR is unset', () => {
		expect(resolveTileDir({}, CWD, (p: string) => p === '/opt/zyeta-aero/tiles')).toBe(
			'/opt/zyeta-aero/tiles',
		);
	});

	it('falls back to parent data/tiles when local cache is empty', () => {
		const hasContent = (dir: string) => dir === '/srv/data/tiles';
		expect(resolveTileDir({}, CWD, () => false, hasContent)).toBe('/srv/data/tiles');
	});

	it('falls back to cwd/data/tiles when Pi path and caches missing', () => {
		expect(resolveTileDir({}, CWD, () => false)).toBe(`${CWD}/data/tiles`);
	});
});

describe('remoteTileUrl', () => {
	it('maps esri-world-imagery to ArcGIS', () => {
		expect(remoteTileUrl('esri-world-imagery/4/7/11.jpg')).toBe(
			'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/4/7/11',
		);
	});

	it('maps cartodb-dark XYZ order in the remote URL', () => {
		expect(remoteTileUrl('cartodb-dark/4/7/11.png')).toBe(
			'https://a.basemaps.cartocdn.com/dark_all/4/11/7.png',
		);
	});
});

describe('remoteFallbackEnabled', () => {
	it('is off in production unless explicitly enabled', () => {
		expect(remoteFallbackEnabled({ NODE_ENV: 'production' })).toBe(false);
		expect(remoteFallbackEnabled({ NODE_ENV: 'production', AERO_TILE_REMOTE_FALLBACK: '1' })).toBe(
			true,
		);
	});

	it('is on in development unless explicitly disabled', () => {
		expect(remoteFallbackEnabled({ NODE_ENV: 'development' })).toBe(true);
		expect(remoteFallbackEnabled({ NODE_ENV: 'development', AERO_TILE_REMOTE_FALLBACK: '0' })).toBe(
			false,
		);
	});

	it('fails closed when NODE_ENV is unset — the Pi must not reach the internet', () => {
		// A bare systemd ExecStart sets no NODE_ENV. That must not read as dev.
		expect(remoteFallbackEnabled({})).toBe(false);
		expect(remoteFallbackEnabled({ NODE_ENV: '' })).toBe(false);
		expect(remoteFallbackEnabled({ AERO_TILE_REMOTE_FALLBACK: '1' })).toBe(true);
	});
});

describe('resolveLocalTile', () => {
	const root = join(tmpdir(), 'aero-tiles-resolve-test');

	it('returns forbidden for path traversal', () => {
		const hit = resolveLocalTile(root, '../secret.jpg');
		expect(hit.forbidden).toBe(true);
	});

	it('falls through to notFound when no candidate exists', () => {
		const hit = resolveLocalTile(root, 'esri-world-imagery/99/99/99.jpg');
		expect(hit.notFound).toBe(true);
		expect(hit.forbidden).toBe(false);
	});
});

describe('GET /api/tiles/[...path]', () => {
	let tileRoot: string;
	// Minimal event slice — handler only reads params.path and request.
	let GET: (event: { params: { path?: string }; request: Request }) => Promise<Response>;

	beforeEach(async () => {
		tileRoot = mkdtempSync(join(tmpdir(), 'aero-tiles-route-'));
		vi.stubEnv('TILE_DIR', tileRoot);
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubGlobal('fetch', vi.fn());
		vi.resetModules();
		const mod = await import('../../../src/routes/api/tiles/[...path]/+server.ts');
		GET = mod.GET as typeof GET;
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('reports health with layer directories', async () => {
		mkdirSync(join(tileRoot, 'eox-sentinel2', '4'), { recursive: true });
		writeFileSync(join(tileRoot, 'eox-sentinel2', '4', 'placeholder'), '');

		const res = await GET({
			params: { path: 'health' },
			request: new Request('http://localhost/api/tiles/health'),
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.hasTiles).toBe(true);
		expect(body.layers).toContain('eox-sentinel2');
	});

	it('serves a tile from disk', async () => {
		mkdirSync(join(tileRoot, 'eox-sentinel2', '4', '7'), { recursive: true });
		writeFileSync(join(tileRoot, 'eox-sentinel2', '4', '7', '11.jpg'), 'jpeg-bytes');

		const res = await GET({
			params: { path: 'eox-sentinel2/4/7/11.jpg' },
			request: new Request('http://localhost/api/tiles/eox-sentinel2/4/7/11.jpg'),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/jpeg');
		expect(res.headers.get('content-length')).toBe('10');
	});

	it('proxies a missing tile in development', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(new Uint8Array([0xff, 0xd8]), {
				status: 200,
				headers: { 'content-type': 'image/jpeg' },
			}),
		);

		const res = await GET({
			params: { path: 'esri-world-imagery/4/7/7.jpg' },
			request: new Request('http://localhost/api/tiles/esri-world-imagery/4/7/7.jpg'),
		});

		expect(res.status).toBe(200);
		expect(fetch).toHaveBeenCalledWith(
			'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/4/7/7',
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	it('returns 404 for a missing tile when remote fallback is off', async () => {
		vi.stubEnv('AERO_TILE_REMOTE_FALLBACK', '0');
		vi.resetModules();
		const mod = await import('../../../src/routes/api/tiles/[...path]/+server.ts');
		GET = mod.GET as typeof GET;

		const res = await GET({
			params: { path: 'esri-world-imagery/4/7/7.jpg' },
			request: new Request('http://localhost/api/tiles/esri-world-imagery/4/7/7.jpg'),
		});

		expect(res.status).toBe(404);
		expect(fetch).not.toHaveBeenCalled();
	});
});
