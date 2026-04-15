/**
 * /api/assets — uploaded asset management.
 *
 * GET  → list installed assets ({ filename, size, url })
 * POST → multipart/form-data upload, returns { ok, asset } with the URL the
 *        bundle author should reference.
 *
 * Files are content-addressed (SHA-256), so duplicate uploads are deduped.
 */

import { json, error } from '@sveltejs/kit';
import { listAssets, saveAsset, isAllowedExtension } from '$lib/scene/bundle/assets.server';
import type { RequestHandler } from './$types';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB cap per upload

export const GET: RequestHandler = async () => {
	const assets = await listAssets();
	return json({ assets });
};

export const POST: RequestHandler = async ({ request }) => {
	const len = Number(request.headers.get('content-length') ?? 0);
	if (Number.isFinite(len) && len > MAX_BYTES) {
		error(413, 'asset too large (max 50 MB)');
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		error(400, 'expected multipart/form-data');
	}

	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'missing form field "file"');
	if (file.size > MAX_BYTES) error(413, 'asset too large (max 50 MB)');
	if (!isAllowedExtension(file.name)) {
		error(400, 'unsupported file type — allowed: mp4, webm, png, jpg, webp');
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	const asset = await saveAsset(file.name, bytes);
	return json({ ok: true, asset });
};
