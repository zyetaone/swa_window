/**
 * POST /api/command — one-shot command from admin or a panorama leader.
 *
 * Body: { type: string; ...payload }
 *
 * Currently supports:
 *   type: 'director_decision' — leader telling follower which scenario/
 *     location to flyTo at a wall-clock `transitionAtMs`. Payload matches
 *     the v2 director_decision shape (kept for continuity).
 *   type: 'set_scene'         — admin forcing a scene change.
 *   type: 'set_mode'          — admin switching display mode.
 *
 * The endpoint doesn't validate the payload shape beyond needing a `type`
 * string. It publishes the full body to the SSE bus so the local browser
 * can handle it. Unknown types are ignored by the browser handler.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readLimitedJson } from '$lib/http/body';
import { lanCorsHeaders, lanCorsHeadersFull } from '$lib/http/cors';
import { publish } from '$lib/fleet/sse-bus.server';

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, {
		status: 204,
		headers: lanCorsHeadersFull(request.headers.get('origin'), 'POST, OPTIONS'),
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');
	const body = await readLimitedJson<{ type: string }>(request, 4096);

	if (!body || typeof body.type !== 'string') {
		throw error(400, 'command body must include `type`');
	}

	publish({ type: 'command', data: body });

	return json({ ok: true }, { headers: lanCorsHeaders(origin) });
};
