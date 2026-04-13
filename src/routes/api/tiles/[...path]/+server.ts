/**
 * Tile Server — SvelteKit route replacing standalone tile-server/.
 *
 * Serves pre-downloaded tiles from TILE_DIR for offline Cesium operation.
 * GET /api/tiles/health          → status
 * GET /api/tiles/{layer}/{z}/{x}/{y}.ext → tile file
 * GET /api/tiles/terrain/layer.json      → terrain metadata
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { RequestHandler } from './$types';

const TILE_DIR = process.env.TILE_DIR || '/opt/zyeta-aero/tiles';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const MIME: Record<string, string> = {
	'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
	'.terrain': 'application/vnd.quantized-mesh', '.json': 'application/json',
};

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, { status: 204, headers: CORS });
};

export const GET: RequestHandler = async ({ params }) => {
	const path = params.path ?? '';

	if (path === 'health') {
		return new Response(JSON.stringify({ status: 'ok', tileDir: TILE_DIR }), {
			headers: { ...CORS, 'Content-Type': 'application/json' },
		});
	}

	const filePath = join(TILE_DIR, path);

	// Prevent path traversal
	if (!filePath.startsWith(TILE_DIR)) {
		return new Response('Forbidden', { status: 403 });
	}

	if (!existsSync(filePath)) {
		return new Response('Not found', { status: 404, headers: CORS });
	}

	const ext = filePath.substring(filePath.lastIndexOf('.'));
	const contentType = MIME[ext] ?? 'application/octet-stream';

	const file = Bun.file(filePath);
	return new Response(file, {
		headers: {
			...CORS,
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
};
