/**
 * Tile Server — SvelteKit route replacing standalone tile-server/.
 *
 * Serves pre-downloaded tiles from TILE_DIR for offline Cesium operation.
 *
 * Two path conventions are supported:
 *
 *   1. WMTS layout  — stored as {layer}/{z}/{y}/{x}.ext  (tile-packager default)
 *      Request:      /api/tiles/{layer}/{z}/{y}/{x}.ext
 *      Maps to:      TILE_DIR/{layer}/{z}/{y}/{x}.ext
 *
 *   2. XYZ layout   — standard web mercator {z}/{x}/{y} convention used by MapLibre
 *      Request:      /api/tiles/xyz/{layer}/{z}/{x}/{y}.ext
 *      Maps to:      TILE_DIR/{layer}/{z}/{y}/{x}.ext  (swaps x/y)
 *
 * GET /api/tiles/health                   → status
 */

import { createReadStream, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RequestHandler } from './$types';
import { lanCorsHeaders } from '$lib/http/cors';

// Resolve TILE_DIR from project root (five levels up from this route file).
// Fallback chain: TILE_DIR env → /opt/zyeta-aero/tiles (Pi deploy) → ./data/tiles (dev)
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
function resolveTileDir(): string {
	if (process.env.TILE_DIR) return resolve(PROJECT_ROOT, process.env.TILE_DIR);
	const piPath = '/opt/zyeta-aero/tiles';
	if (existsSync(piPath)) return piPath;
	return resolve(PROJECT_ROOT, 'data/tiles');
}
const TILE_DIR = resolveTileDir().replace(/\/$/, '') + '/';

const MIME: Record<string, string> = {
	'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
	'.terrain': 'application/vnd.quantized-mesh', '.json': 'application/json',
};

export const OPTIONS: RequestHandler = async ({ request }) => {
	const cors = { ...lanCorsHeaders(request.headers.get('Origin')), 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
	return new Response(null, { status: 204, headers: cors });
};

function safeResolve(subPath: string): { filePath: string; notFound: boolean; forbidden: boolean } {
	const filePath = resolve(TILE_DIR, subPath);
	if (!filePath.startsWith(TILE_DIR)) return { filePath, notFound: false, forbidden: true };
	if (!existsSync(filePath)) return { filePath, notFound: true, forbidden: false };
	try {
		const real = realpathSync(filePath);
		if (!real.startsWith(TILE_DIR)) return { filePath, notFound: false, forbidden: true };
	} catch { return { filePath, notFound: true, forbidden: false }; }
	return { filePath, notFound: false, forbidden: false };
}

function serveTile(filePath: string, cors: Record<string, string>): Response {
	const ext = filePath.substring(filePath.lastIndexOf('.'));
	const contentType = MIME[ext] ?? 'application/octet-stream';
	const { size } = statSync(filePath);
	const stream = createReadStream(filePath);
	return new Response(stream as any, {
		headers: {
			...cors,
			'Content-Type': contentType,
			'Content-Length': String(size),
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
}

export const GET: RequestHandler = async ({ params, request }) => {
	const path = params.path ?? '';
	const cors = lanCorsHeaders(request.headers.get('Origin'));

	if (path === 'health') {
		return new Response(JSON.stringify({ status: 'ok' }), {
			headers: { ...cors, 'Content-Type': 'application/json' },
		});
	}

	// XYZ proxy: /api/tiles/xyz/{layer}/{z}/{x}/{y}.ext
	// Remaps to TILE_DIR/{layer}/{z}/{y}/{x}.ext
	const xyzMatch = path.match(/^xyz\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(.+)$/);
	if (xyzMatch) {
		const [, layer, z, x, y, ext] = xyzMatch;
		const remapped = `${layer}/${z}/${y}/${x}.${ext}`;
		const { filePath, notFound, forbidden } = safeResolve(remapped);
		if (forbidden) return new Response('Forbidden', { status: 403 });
		if (notFound) return new Response('Not found', { status: 404, headers: cors });
		return serveTile(filePath, cors);
	}

	// Direct WMTS path: /api/tiles/{layer}/{z}/{y}/{x}.ext
	const { filePath, notFound, forbidden } = safeResolve(path);
	if (forbidden) return new Response('Forbidden', { status: 403 });
	if (notFound) return new Response('Not found', { status: 404, headers: cors });
	return serveTile(filePath, cors);
};
