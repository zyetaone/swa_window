/**
 * Tile Server — serves pre-downloaded tiles from TILE_DIR so the window works offline.
 *
 *   1. WMTS layout  — /api/tiles/{layer}/{z}/{y}/{x}.ext
 *   2. XYZ proxy    — /api/tiles/xyz/{layer}/{z}/{x}/{y}.ext → WMTS on disk
 *   GET /api/tiles/health → { status, hasTiles, layers }
 */

import { createReadStream, statSync, readdirSync } from 'node:fs';
import type { RequestHandler } from './$types';
import {
	corsPreflight,
	lanCorsHeaders,
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

export const OPTIONS: RequestHandler = corsPreflight('GET, OPTIONS');

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
	// The client cannot infer this, and navigator.onLine lies on a LAN with no
	// route out. Ask the server, which actually knows.
	return {
		status: 'ok',
		hasTiles: layers.length > 0,
		layers,
		remoteFallback: remoteFallbackEnabled()
	};
}

/**
 * Tiles are content-addressed by z/x/y and never change in place, so a
 * year-long immutable cache is correct — and it is what keeps a Pi off the
 * network after the first pass over a location.
 */
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

/**
 * Upstream tile latency is wildly variable — the same terrarium tile measured
 * 1.9 s and 7.6 s minutes apart from the same machine. At the old 8 s this sat
 * right on the edge, so a slow-but-fine tile aborted and was served as a 404:
 * 2 143 of them in one dev session, for tiles that existed upstream the whole
 * time. This is a cache-fill path, not a user-facing request, so waiting is
 * strictly better than discarding a tile we will only ask for again.
 */
const REMOTE_TIMEOUT_MS = 20_000;

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

function serveLocalFile(filePath: string, cors: Record<string, string>): Response {
	const ext = filePath.substring(filePath.lastIndexOf('.'));
	const { size } = statSync(filePath);
	// Streamed rather than read into memory: a Pi 5 serving three panes should
	// not hold whole tiles in the heap.
	return serveTile(createReadStream(filePath) as unknown as BodyInit, MIME[ext] ?? OCTET, cors, {
		'Content-Length': String(size)
	});
}

async function resolveTileResponse(
	path: string,
	cors: Record<string, string>
): Promise<Response | 'forbidden' | null> {
	const local = resolveLocalTile(TILE_DIR, path);
	if (local.forbidden) return 'forbidden';
	if (!local.notFound) return serveLocalFile(local.filePath, cors);

	if (remoteFallbackEnabled()) {
		const remote = remoteTileUrl(path);
		if (remote) {
			const proxied = await serveRemote(remote, cors);
			if (proxied) return proxied;
		}
	}

	return null;
}

export const GET: RequestHandler = async ({ params, request }) => {
	const path = params.path ?? '';
	const cors = lanCorsHeaders(request.headers.get('Origin'));

	if (path === 'health') {
		return new Response(JSON.stringify(tileHealth()), {
			headers: { ...cors, 'Content-Type': 'application/json' }
		});
	}

	// XYZ (what MapLibre asks for) and WMTS (what is on disk) differ only in
	// whether y or x comes first, so the proxy is a reorder, not a second path.
	const xyzMatch = path.match(/^xyz\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(.+)$/);
	const wmtsPath = xyzMatch
		? `${xyzMatch[1]}/${xyzMatch[2]}/${xyzMatch[4]}/${xyzMatch[3]}.${xyzMatch[5]}`
		: path;

	const hit = await resolveTileResponse(wmtsPath, cors);
	if (hit === 'forbidden') return new Response('Forbidden', { status: 403 });
	if (hit) return hit;
	return new Response('Not found', { status: 404, headers: cors });
};
