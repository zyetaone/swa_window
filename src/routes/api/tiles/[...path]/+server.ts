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
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { RequestHandler } from './$types';
import { lanCorsHeaders, corsPreflight } from '$lib/http/cors';
import { safeResolveWithin } from '$lib/server/fs-guard';

// Anchor relative paths on process.cwd() — the repo root in dev, the deploy
// dir on the Pi. import.meta.url depth-counting breaks after bundling: the
// emitted chunk lives deeper than the source route file, so 'five levels up'
// no longer lands on the project root.
// Fallback chain: TILE_DIR env → /opt/zyeta-aero/tiles (Pi deploy) → ./data/tiles (dev)
export function resolveTileDir(
	env: NodeJS.ProcessEnv = process.env,
	cwd: string = process.cwd(),
	piDirExists: (path: string) => boolean = existsSync,
): string {
	// resolve() returns an absolute TILE_DIR unchanged — absolute fast path.
	if (env.TILE_DIR) return resolve(cwd, env.TILE_DIR);
	const piPath = '/opt/zyeta-aero/tiles';
	if (piDirExists(piPath)) return piPath;
	return resolve(cwd, 'data/tiles');
}
const TILE_DIR = resolveTileDir().replace(/\/$/, '') + '/';

const MIME: Record<string, string> = {
	'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
	'.terrain': 'application/vnd.quantized-mesh', '.json': 'application/json',
};

export const OPTIONS: RequestHandler = corsPreflight('GET, OPTIONS');

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
		const { filePath, notFound, forbidden } = safeResolveWithin(TILE_DIR, remapped);
		if (forbidden) return new Response('Forbidden', { status: 403 });
		if (notFound) return new Response('Not found', { status: 404, headers: cors });
		return serveTile(filePath, cors);
	}

	// Direct WMTS path: /api/tiles/{layer}/{z}/{y}/{x}.ext
	const { filePath, notFound, forbidden } = safeResolveWithin(TILE_DIR, path);
	if (forbidden) return new Response('Forbidden', { status: 403 });
	if (notFound) return new Response('Not found', { status: 404, headers: cors });
	return serveTile(filePath, cors);
};
