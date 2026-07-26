/**
 * Shared handler for the two routes whose entire job is "authenticate, bound,
 * validate, publish to the SSE bus": PATCH /api/config and POST /api/command.
 *
 * They stay SEPARATE routes on purpose — the URLs are fielded wire contract
 * (kiosk leader→follower fan-out and the admin dashboard both POST to fixed
 * paths, and old Pis decode what they already know). What was duplicated is
 * the handler body, which was identical modulo one validation step: token
 * gate, origin read, 4 KB cap, publish, `{ok:true}` + LAN CORS. Drifting
 * either copy — a different body cap, a forgotten CORS header, an auth check
 * that moves below the parse — is a security difference that no test would
 * have caught, since both routes would still return 200.
 */

import { json } from '@sveltejs/kit';
import { readLimitedJson } from './body';
import { lanCorsHeaders } from './cors';
import { requireAdminToken } from './auth';
import { publish, type SseEvent } from '$lib/fleet/sse-bus.server';

/**
 * 4 KB. Both payloads are small structured JSON (a config path + scalar, or a
 * command type + a few fields); the cap is a DoS bound, not a feature budget.
 */
const MAX_BODY_BYTES = 4096;

/**
 * Build a POST/PATCH handler that publishes one SSE event.
 *
 * `toEvent` receives the parsed body (or null if the payload was absent or
 * unparseable) and returns the event to publish. It is the ONLY per-route
 * logic — throw `error(400, …)` from inside it to reject.
 *
 * Auth runs before the body is read, so an unauthenticated caller never
 * reaches the parser.
 */
export function publishRoute<T>(toEvent: (body: T | null) => SseEvent) {
	return async ({ request }: { request: Request }) => {
		requireAdminToken(request);
		const origin = request.headers.get('origin');
		const body = await readLimitedJson<T>(request, MAX_BODY_BYTES);
		publish(toEvent(body));
		return json({ ok: true }, { headers: lanCorsHeaders(origin) });
	};
}
