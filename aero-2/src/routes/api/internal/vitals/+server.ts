/**
 * POST /api/internal/vitals — this pane's browser reporting its own frame rate.
 *
 * LOOPBACK ONLY, exactly like `/api/internal/thermal` next door and for the
 * same reason: it is a fact about THIS device that only this device may state.
 * An open endpoint would let anything on a venue LAN write a fleet pane's fps,
 * which is both a lie in the cockpit and a way to hide a dying wall.
 *
 * The tab and the server share an origin, so the kiosk's own fetch is loopback
 * and passes; a phone on the same WiFi does not.
 *
 * Fire-and-forget by design. The caller must never wait on this — a wedged
 * health POST that blocked a frame would make the render loop worse to measure
 * itself, which is the sort of instrument that changes what it observes.
 */

import { json } from '@sveltejs/kit';

import { isLoopback } from '#lib/server/loopback.js';
import { readLimitedJson } from '#lib/server/body.js';
import { recordVitals } from '#lib/server/vitals.js';
import type { RequestHandler } from './$types';

/** Two numbers. Anything larger is not this payload. */
const MAX_BYTES = 512;

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!isLoopback(getClientAddress())) {
		return json({ error: 'loopback only' }, { status: 403 });
	}

	const body = await readLimitedJson<unknown>(request, MAX_BYTES);
	if (!body.ok) return body.response;

	const b = body.value as Record<string, unknown> | null;
	if (!b || typeof b.fps !== 'number' || typeof b.frameTimeMs !== 'number') {
		return json({ error: 'fps and frameTimeMs are required numbers' }, { status: 400 });
	}

	recordVitals(b.fps, b.frameTimeMs);
	return json({ ok: true });
};
