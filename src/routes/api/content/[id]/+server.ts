/**
 * DELETE /api/content/[id] — remove a single installed bundle.
 * 404 if the id isn't currently installed.
 */

import { json, error } from '@sveltejs/kit';
import { deleteBundle } from '$lib/scene/bundle/disk.server';
import type { RequestHandler } from './$types';

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export const DELETE: RequestHandler = async ({ params }) => {
	const id = params.id;
	if (!id || !ID_PATTERN.test(id)) error(400, 'invalid id');
	const ok = await deleteBundle(id);
	if (!ok) error(404, 'bundle not found');
	return json({ ok: true });
};
