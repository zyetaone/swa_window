/**
 * GET /api/assets/[filename] — serve a stored asset with its mime type.
 * 404 if the file isn't present, 400 on invalid filename pattern.
 */

import { error } from '@sveltejs/kit';
import { readAsset, mimeFor } from '$lib/scene/bundle/assets.server';
import type { RequestHandler } from './$types';

// Allow content-addressed names (16-hex hash + ext) — strict to avoid path traversal.
const NAME_PATTERN = /^[a-f0-9]{16}\.(mp4|webm|png|jpg|jpeg|webp)$/i;

export const GET: RequestHandler = async ({ params }) => {
	const filename = params.filename;
	if (!filename || !NAME_PATTERN.test(filename)) error(400, 'invalid filename');

	const bytes = await readAsset(filename);
	if (!bytes) error(404, 'asset not found');

	// Wrap in Blob so the Response BodyInit type accepts it cleanly across
	// the @sveltejs/kit + @types/node typing surface (Uint8Array directly
	// is technically valid as a BufferSource but typing is finicky).
	return new Response(new Blob([new Uint8Array(bytes)]), {
		headers: {
			'Content-Type': mimeFor(filename),
			'Content-Length': String(bytes.byteLength),
			// Content-addressed → safe to cache forever
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
};
