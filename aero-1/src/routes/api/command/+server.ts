/**
 * POST /api/command — one-shot command from admin or a panorama leader.
 *
 * Body: { type: string; ...payload }
 *
 * Currently supports:
 *   type: 'director_decision' — leader telling follower which scenario/
 *     location to flyTo at a wall-clock `transitionAtMs`. Payload matches
 *     the v2 director_decision shape (kept for continuity).
 *   type: 'vantage_beat'      — leader telling followers to enter a night-city
 *     flyover (pitch down) at `transitionAtMs` for `durationMs`, then exit.
 *   type: 'scene_resync'      — leader telling a peer that just (re)joined
 *                               where the wall currently is. Receiver ignores
 *                               it when already on that location, so it is
 *                               safe to send liberally.
 *   type: 'set_scene'         — admin forcing a scene change.
 *   type: 'set_mode'          — admin switching display mode.
 *
 * The endpoint doesn't validate the payload shape beyond needing a `type`
 * string. It publishes the full body to the SSE bus so the local browser
 * can handle it. Unknown types are ignored by the browser handler.
 *
 * Bearer-gated (AERO_ADMIN_TOKEN), same as PATCH /api/config — a compromised
 * peer can no longer fan fabricated `director_decision`/`set_scene` to the
 * fleet. Both POST callers inject the token via the shared peer-token path:
 * the kiosk's leader→follower fan-out (client.svelte.ts publishV2) and the
 * admin dashboard (rest-admin.svelte.ts #postCommand) each spread
 * `peerAuthHeader()` — the exact pattern rest-admin already uses for
 * /api/config. Fail-closed: 503 when AERO_ADMIN_TOKEN is unset (matches the
 * other admin routes), so a Pi that didn't opt in simply has no working
 * command path rather than an open one.
 *
 * ⚠ Validate on the real 3-Pi rig (P8 pass): confirm leader→follower scene
 * sync AND the admin "force scene" still land end-to-end with the gate on.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { corsPreflight } from '$lib/http/cors';
import { publishRoute } from '$lib/http/publish-route';

export const OPTIONS: RequestHandler = corsPreflight('POST, OPTIONS');

export const POST: RequestHandler = publishRoute<{ type: string }>((body) => {
	if (!body || typeof body.type !== 'string') {
		throw error(400, 'command body must include `type`');
	}
	return { type: 'command', data: body };
});
