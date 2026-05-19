/**
 * Bearer-token gate for admin-mutating endpoints.
 *
 * Two callers today:
 *   requireAdminToken(req)    — generic admin routes (AERO_ADMIN_TOKEN)
 *   /api/wifi/reset           — uses requireBearerToken(req, 'AERO_WIFI_RESET_TOKEN', 'wifi reset')
 *
 * The split is operational, not technical: the wifi-reset token is held by
 * field techs, the admin token by the SWA admin. Same gate shape.
 *
 * Fail-closed semantics: when the env var is unset the route returns 503
 * (no accidental admin writes on Pis that didn't opt in). Set + wrong → 401.
 * Constant-time compare so response timing doesn't leak the secret.
 */

import { error } from '@sveltejs/kit';

/**
 * Reads `process.env[envVar]` and validates `Authorization: Bearer <token>`
 * against it. `label` is interpolated into the 503 error message so the
 * operator sees which endpoint refused (useful when several gates coexist).
 * Throws 503 if env unset, 401 if header missing/malformed/wrong.
 */
export function requireBearerToken(request: Request, envVar: string, label: string): void {
	const expected = process.env[envVar];
	if (!expected) {
		throw error(503, `${label} disabled: ${envVar} not set`);
	}

	const header = request.headers.get('authorization') ?? '';
	const match = header.match(/^Bearer\s+(.+)$/i);
	const presented = match?.[1]?.trim();

	if (!presented || !timingSafeEqual(presented, expected)) {
		throw error(401, 'invalid bearer token');
	}
}

/** Shorthand for the generic admin gate. Equivalent to requireBearerToken(req, 'AERO_ADMIN_TOKEN', 'admin endpoint'). */
export function requireAdminToken(request: Request): void {
	requireBearerToken(request, 'AERO_ADMIN_TOKEN', 'admin endpoint');
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
