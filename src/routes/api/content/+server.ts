/**
 * /api/content — content bundle management.
 *
 * GET  → list all installed bundles (read-only, no auth)
 * POST → install/replace a bundle (JSON body = ContentBundle, requires bearer)
 *
 * DELETE is handled at /api/content/[id] so clients can scope deletions.
 *
 * Auth: POST requires `Authorization: Bearer $AERO_ADMIN_TOKEN`. Returns 503
 * if the env var is unset (fail closed) — admin must explicitly opt in.
 */

import { json, error } from '@sveltejs/kit';
import { listBundles, saveBundle } from '$lib/scene/bundle/disk.server';
import { isContentBundle, BUNDLE_ID_PATTERN } from '$lib/scene/bundle/types';
import { readLimitedJson } from '$lib/http/body';
import { requireAdminToken } from '$lib/http/auth';
import type { RequestHandler } from './$types';

const MAX_BODY_BYTES = 64 * 1024; // 64 KB is plenty for a JSON manifest

export const GET: RequestHandler = async () => {
	const bundles = await listBundles();
	return json({ bundles });
};

export const POST: RequestHandler = async ({ request }) => {
	requireAdminToken(request);
	// readLimitedJson counts actual bytes received — covers the content-length
	// bypass (chunked transfer encoding) because it enforces the cap mid-stream
	// before any JSON parsing occurs.
	const body = await readLimitedJson<unknown>(request, MAX_BODY_BYTES);

	if (!isContentBundle(body)) error(400, 'invalid bundle shape');
	if (!BUNDLE_ID_PATTERN.test(body.id)) {
		error(400, 'invalid id — use [a-zA-Z0-9_-], 1..64 chars');
	}

	await saveBundle(body);
	return json({ ok: true, id: body.id });
};
