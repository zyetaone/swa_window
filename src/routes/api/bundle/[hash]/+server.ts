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
import { readLocal } from '$lib/fleet/lan-proxy.server';
import { lanCorsHeaders } from '$lib/http/cors';

export const GET: RequestHandler = async ({ params, request }) => {
	const hash = params.hash ?? '';
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
