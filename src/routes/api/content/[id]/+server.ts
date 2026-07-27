/**
 * DELETE /api/content/[id] — remove a single installed bundle.
 * 404 if the id isn't currently installed.
 *
 * Auth: requires `Authorization: Bearer $AERO_ADMIN_TOKEN`. Returns 503
 * when the env var is unset (fail closed).
 */

import { json, error } from '@sveltejs/kit';
import { deleteBundle } from '$lib/scene/bundle/disk.server';
import { BUNDLE_ID_PATTERN } from '$lib/scene/bundle/types';
import { requireAdminToken } from '$lib/http/auth';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, request }) => {
	requireAdminToken(request);
	const id = params.id;
	if (!id || !BUNDLE_ID_PATTERN.test(id)) error(400, 'invalid id');
	const ok = await deleteBundle(id);
	if (!ok) error(404, 'bundle not found');
	return json({ ok: true });
};
