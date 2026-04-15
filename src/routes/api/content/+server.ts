/**
 * /api/content — content bundle management.
 *
 * GET  → list all installed bundles
 * POST → install/replace a bundle (JSON body = ContentBundle)
 *
 * DELETE is handled at /api/content/[id] so clients can scope deletions.
 *
 * Auth: none for now (LAN device). Phase 4 can add a shared-secret header
 * before the device is sold as a standalone product.
 */

import { json, error } from '@sveltejs/kit';
import { listBundles, saveBundle } from '$lib/scene/bundle/disk.server';
import { isContentBundle } from '$lib/scene/bundle/loader';
import type { RequestHandler } from './$types';

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_BODY_BYTES = 64 * 1024; // 64 KB is plenty for a JSON manifest

export const GET: RequestHandler = async () => {
	const bundles = await listBundles();
	return json({ bundles });
};

export const POST: RequestHandler = async ({ request }) => {
	// Reject oversized payloads up front.
	const len = Number(request.headers.get('content-length') ?? 0);
	if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
		error(413, 'bundle too large');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'invalid JSON');
	}

	if (!isContentBundle(body)) error(400, 'invalid bundle shape');
	if (!ID_PATTERN.test(body.id)) {
		error(400, 'invalid id — use [a-zA-Z0-9_-], 1..64 chars');
	}

	await saveBundle(body);
	return json({ ok: true, id: body.id });
};
