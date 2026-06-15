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
 *
 * ⚠ KNOWN GAP (tracked for the P8 hardware pass): unlike PATCH /api/config,
 * this route is NOT bearer-gated. Acceptable under the LAN-only / physical-
 * access threat model, but a compromised kiosk could fan fabricated
 * `director_decision`/`set_scene` to peers. Closing it requires `requireAdminToken`
 * here PLUS injecting the token into all three POST callers — the kiosk's own
 * browser (localhost peer-token), a remote admin laptop (sessionStorage prompt,
 * like the content routes), and the leader→follower fan-out (client.svelte.ts) —
 * verified on the fleet so neither 3-Pi sync nor the admin "force scene" breaks.
 * Deferred to the hardware pass for that reason; do NOT half-gate it.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readLimitedJson } from '$lib/http/body';
import { lanCorsHeaders, corsPreflight } from '$lib/http/cors';
import { publish } from '$lib/fleet/sse-bus.server';

export const OPTIONS: RequestHandler = corsPreflight('POST, OPTIONS');

export const POST: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');
	const body = await readLimitedJson<{ type: string }>(request, 4096);

	if (!body || typeof body.type !== 'string') {
		throw error(400, 'command body must include `type`');
	}

	publish({ type: 'command', data: body });

	return json({ ok: true }, { headers: lanCorsHeaders(origin) });
};
