/**
 * GET /api/assets/[filename] — serve a stored asset with its mime type.
 * 404 if the file isn't present, 400 on invalid filename pattern.
 */

import { error } from '@sveltejs/kit';
import { openAsset, mimeFor } from '$lib/server/bundle/assets';
import type { RequestHandler } from './$types';

// Allow content-addressed names (16-hex hash + ext) — strict to avoid path traversal.
const NAME_PATTERN = /^[a-f0-9]{16}\.(mp4|webm|png|jpg|jpeg|webp)$/i;

export const GET: RequestHandler = async ({ params }) => {
	const filename = params.filename;
	if (!filename || !NAME_PATTERN.test(filename)) error(400, 'invalid filename');

	// Streamed, not buffered: a 50 MB video read into memory competes with the
	// render loop on the same Pi. See openAsset for why there is no Range here.
	const asset = await openAsset(filename);
	if (!asset) error(404, 'asset not found');

	return new Response(asset.stream, {
		headers: {
			'Content-Type': mimeFor(filename),
			'Content-Length': String(asset.size),
			// Content-addressed → safe to cache forever
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
};
