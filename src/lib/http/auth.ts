/**
 * Bearer-token gate for mutating admin endpoints.
 *
 * Reads `AERO_ADMIN_TOKEN` from env. If unset, the endpoint fails closed
 * with 503 (no accidental admin writes on Pis that didn't opt in). If set,
 * requires `Authorization: Bearer <token>` with constant-time compare so
 * response timing doesn't leak the secret byte-by-byte.
 *
 * Same shape as $lib/http/cors helpers — drop a single call at the top of
 * each gated route handler. /api/wifi/reset uses an endpoint-specific token
 * (AERO_WIFI_RESET_TOKEN); everything else gated should use this helper.
 */

import { error } from '@sveltejs/kit';

/** Throws 503 if AERO_ADMIN_TOKEN is unset, 401 if header missing/wrong. */
export function requireAdminToken(request: Request): void {
	const expected = process.env.AERO_ADMIN_TOKEN;
	if (!expected) {
		throw error(503, 'admin endpoint disabled: AERO_ADMIN_TOKEN not set');
	}

	const header = request.headers.get('authorization') ?? '';
	const match = header.match(/^Bearer\s+(.+)$/i);
	const presented = match?.[1]?.trim();

	if (!presented || !timingSafeEqual(presented, expected)) {
		throw error(401, 'invalid bearer token');
	}
}

/**
 * Constant-time string compare. Vanilla === leaks the token byte-by-byte
 * through response timing. Length mismatch short-circuits, which only leaks
 * "wrong length" — fine because the token is fixed-length per deployment.
 */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}
