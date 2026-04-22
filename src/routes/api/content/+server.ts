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
import { readLimitedJson } from '$lib/http/body';
import type { RequestHandler } from './$types';

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_BODY_BYTES = 64 * 1024; // 64 KB is plenty for a JSON manifest

export const GET: RequestHandler = async () => {
	const bundles = await listBundles();
	return json({ bundles });
};

export const POST: RequestHandler = async ({ request }) => {
	// readLimitedJson counts actual bytes received — covers the content-length
	// bypass (chunked transfer encoding) because it enforces the cap mid-stream
	// before any JSON parsing occurs.
	const body = await readLimitedJson<unknown>(request, MAX_BODY_BYTES);

	if (!isContentBundle(body)) error(400, 'invalid bundle shape');
	if (!ID_PATTERN.test(body.id)) {
		error(400, 'invalid id — use [a-zA-Z0-9_-], 1..64 chars');
	}

	await saveBundle(body);
	return json({ ok: true, id: body.id });
};
