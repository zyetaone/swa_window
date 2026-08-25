/**
 * Tile Server — serves pre-downloaded tiles from TILE_DIR for offline Cesium.
 *
 *   1. WMTS layout  — /api/tiles/{layer}/{z}/{y}/{x}.ext
 *   2. XYZ proxy    — /api/tiles/xyz/{layer}/{z}/{x}/{y}.ext → WMTS on disk
 *   GET /api/tiles/health → { status, hasTiles, layers }
 */

import { createReadStream, statSync, readdirSync } from 'node:fs';
import type { RequestHandler } from './$types';
import { corsPreflight, lanCorsHeaders, remoteFallbackEnabled, remoteTileUrl, resolveLocalTile, resolveTileDir } from '#lib/server/tiles.js';

const TILE_DIR = resolveTileDir().replace(/\/$/, '') + '/';

const MIME: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.terrain': 'application/vnd.quantized-mesh',
	'.json': 'application/json',
};

export const OPTIONS: RequestHandler = corsPreflight('GET, OPTIONS');

function tileHealth(): { status: string; hasTiles: boolean; layers: string[] } {
	let layers: string[] = [];
	try {
		layers = readdirSync(TILE_DIR, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.filter((name) => {
				try {
					return readdirSync(`${TILE_DIR}${name}`).length > 0;
				} catch {
					return false;
				}
			});
	} catch {
		/* TILE_DIR absent */
	}
	return { status: 'ok', hasTiles: layers.length > 0, layers };
}

function serveBytes(body: BodyInit, contentType: string, cors: Record<string, string>): Response {
	return new Response(body, {
		headers: {
			...cors,
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
}

async function serveRemote(url: string, cors: Record<string, string>): Promise<Response | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
		if (!res.ok) return null;
		const type = res.headers.get('content-type') ?? 'application/octet-stream';
		return serveBytes(await res.arrayBuffer(), type, cors);
	} catch {
		return null;
	}
}

async function resolveTileResponse(
	path: string,
	cors: Record<string, string>,
): Promise<Response | 'forbidden' | null> {
	const local = resolveLocalTile(TILE_DIR, path);
	if (local.forbidden) return 'forbidden';
	if (!local.notFound) return serveTile(local.filePath, cors);

	if (remoteFallbackEnabled()) {
		const remote = remoteTileUrl(path);
		if (remote) {
			const proxied = await serveRemote(remote, cors);
			if (proxied) return proxied;
		}
	}

	return null;
}

function serveTile(filePath: string, cors: Record<string, string>): Response {
	const ext = filePath.substring(filePath.lastIndexOf('.'));
	const contentType = MIME[ext] ?? 'application/octet-stream';
	const { size } = statSync(filePath);
	const stream = createReadStream(filePath);
	return new Response(stream as unknown as BodyInit, {
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
		return new Response(JSON.stringify(tileHealth()), {
			headers: { ...cors, 'Content-Type': 'application/json' },
		});
	}

	const xyzMatch = path.match(/^xyz\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(.+)$/);
	if (xyzMatch) {
		const [, layer, z, x, y, ext] = xyzMatch;
		const remapped = `${layer}/${z}/${y}/${x}.${ext}`;
		const hit = await resolveTileResponse(remapped, cors);
		if (hit === 'forbidden') return new Response('Forbidden', { status: 403 });
		if (hit) return hit;
		return new Response('Not found', { status: 404, headers: cors });
	}

	const hit = await resolveTileResponse(path, cors);
	if (hit === 'forbidden') return new Response('Forbidden', { status: 403 });
	if (hit) return hit;
	return new Response('Not found', { status: 404, headers: cors });
};
