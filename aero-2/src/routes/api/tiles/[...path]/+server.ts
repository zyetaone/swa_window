/**
 * Offline Tile Server & PMTiles Range Proxy.
 *
 *   1. WMTS layout  — /api/tiles/{layer}/{z}/{y}/{x}.ext
 *   2. XYZ proxy    — /api/tiles/xyz/{layer}/{z}/{x}/{y}.ext → WMTS on disk
 *   3. Range header — 206 Partial Content for PMTiles archives
 *   4. Health check — GET /api/tiles/health → { status, hasTiles, layers }
 */

import { createReadStream, readdirSync, statSync } from 'node:fs';
import type { RequestHandler } from './$types';
import {
	corsPreflight,
	lanCorsHeaders,
	parseRange,
	remoteFallbackEnabled,
	remoteTileUrl,
	resolveLocalTile,
	resolveTileDir
} from '#lib/server/tiles.js';

const TILE_DIR = resolveTileDir().replace(/\/$/, '') + '/';

const OCTET = 'application/octet-stream';
const MIME: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png'
};

const REMOTE_TIMEOUT_MS = 20_000;

function serveTile(
	body: BodyInit,
	contentType: string,
	cors: Record<string, string>,
	extra: Record<string, string> = {}
): Response {
	return new Response(body, {
		headers: {
			...cors,
			...extra,
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
}

async function serveRemote(url: string, cors: Record<string, string>): Promise<Response | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
		if (!res.ok) return null;
		const type = res.headers.get('content-type') ?? OCTET;
		return serveTile(await res.arrayBuffer(), type, cors);
	} catch {
		return null;
	}
}

function serveLocalFile(
	filePath: string,
	cors: Record<string, string>,
	rangeHeader: string | null = null
): Response {
	const ext = filePath.substring(filePath.lastIndexOf('.'));
	const { size } = statSync(filePath);
	const type = MIME[ext] ?? OCTET;
	const range = parseRange(rangeHeader, size);

	if (range === 'unsatisfiable') {
		return new Response('Range Not Satisfiable', {
			status: 416,
			headers: { ...cors, 'Content-Range': `bytes */${size}` }
		});
	}

	if (range) {
		const { start, end } = range;
		return new Response(createReadStream(filePath, { start, end }) as unknown as BodyInit, {
			status: 206,
			headers: {
				...cors,
				'Content-Type': type,
				'Content-Length': String(end - start + 1),
				'Content-Range': `bytes ${start}-${end}/${size}`,
				'Accept-Ranges': 'bytes',
				'Cache-Control': 'public, max-age=31536000, immutable'
			}
		});
	}

	return serveTile(createReadStream(filePath) as unknown as BodyInit, type, cors, {
		'Content-Length': String(size),
		'Accept-Ranges': 'bytes'
	});
}

function tileHealth(): {
	status: string;
	hasTiles: boolean;
	layers: string[];
	remoteFallback: boolean;
} {
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
	return {
		status: 'ok',
		hasTiles: layers.length > 0,
		layers,
		remoteFallback: remoteFallbackEnabled()
	};
}

async function resolveTileResponse(
	path: string,
	cors: Record<string, string>,
	rangeHeader: string | null = null
): Promise<Response | 'forbidden' | null> {
	const local = resolveLocalTile(TILE_DIR, path);
	if (local.forbidden) return 'forbidden';
	if (!local.notFound) return serveLocalFile(local.filePath, cors, rangeHeader);

	if (remoteFallbackEnabled()) {
		const remote = remoteTileUrl(path);
		if (remote) {
			const proxied = await serveRemote(remote, cors);
			if (proxied) return proxied;
		}
	}

	return null;
}

export const OPTIONS: RequestHandler = corsPreflight('GET, OPTIONS');

export const GET: RequestHandler = async ({ params, request }) => {
	const path = params.path ?? '';
	const cors = lanCorsHeaders(request.headers.get('Origin'));

	if (path === 'health') {
		return new Response(JSON.stringify(tileHealth()), {
			headers: { ...cors, 'Content-Type': 'application/json' }
		});
	}

	const xyzMatch = path.match(/^xyz\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(.+)$/);
	const wmtsPath = xyzMatch
		? `${xyzMatch[1]}/${xyzMatch[2]}/${xyzMatch[4]}/${xyzMatch[3]}.${xyzMatch[5]}`
		: path;

	const hit = await resolveTileResponse(wmtsPath, cors, request.headers.get('Range'));
	if (hit === 'forbidden') return new Response('Forbidden', { status: 403 });
	if (hit) return hit;
	return new Response('Not found', { status: 404, headers: cors });
};
