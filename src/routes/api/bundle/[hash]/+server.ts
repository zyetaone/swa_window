/**
 * LAN bundle proxy endpoint.
 *
 * GET /api/bundle/:hash → the raw blob from this Pi's local cache, or 404.
 *
 * Called by other Pis on the same LAN when a new bundle rolls out. If we
 * already have it cached on disk, we serve it directly so the peer doesn't
 * need to hit the Cloudflare Worker or the original CDN.
 *
 * Security:
 *   - Hash is validated in readLocal() (hex, 16-128 chars) to prevent
 *     directory traversal via path injection.
 *   - We only serve content we've already fetched (cache hits). We never
 *     fetch on behalf of a peer — that would turn every Pi into an open
 *     relay for the internet.
 *   - Short Cache-Control so peers can re-hit the LAN instead of going
 *     remote, but the 30s ceiling keeps stale blobs from lingering.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { lanCorsHeaders } from '$lib/http/cors';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';

function bundleCacheDir(): string {
	return process.env.AERO_LAN_CACHE_DIR ?? './data/lan-cache';
}

function readLocal(hash: string): Promise<Uint8Array | null> {
	if (!/^[a-f0-9]{16,128}$/i.test(hash)) return Promise.resolve(null);
	const path = join(bundleCacheDir(), hash.slice(0, 2), `${hash}.bin`);
	if (!existsSync(path)) return Promise.resolve(null);
	// Symlink-escape guard, mirroring the tiles route. The hash pattern already
	// blocks traversal in the URL, but the cache directory is written by peer
	// sync, so a planted symlink could still point outside it. Compare REAL
	// paths, not the joined string.
	try {
		const root = realpathSync(resolve(bundleCacheDir()));
		const real = realpathSync(path);
		if (real !== root && !real.startsWith(root + '/')) return Promise.resolve(null);
	} catch {
		return Promise.resolve(null);
	}
	return readFile(path).then((b) => new Uint8Array(b)).catch(() => null);
}

export const GET: RequestHandler = async ({ params, request }) => {
	const hash = params.hash ?? '';
	// Same pattern readLocal enforces — duplicate at the boundary so a future
	// loosening of the SSOT can't accidentally widen what reaches the file ops.
	if (!/^[a-f0-9]{16,128}$/i.test(hash)) throw error(400, 'invalid hash');
	const blob = await readLocal(hash);
	if (!blob) throw error(404, 'not cached');
	// The bundle system is content-addressed so the body is immutable per
	// hash. Cache aggressively once we've served it to a peer.
	// Note: Uint8Array → ArrayBuffer cast for Response BodyInit compat.
	return new Response(blob.buffer as ArrayBuffer, {
		status: 200,
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Length': String(blob.byteLength),
			'Cache-Control': 'public, max-age=30',
			...lanCorsHeaders(request.headers.get('Origin')),
		},
	});
};
