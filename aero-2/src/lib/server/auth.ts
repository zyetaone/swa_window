/**
 * Bearer-token gate for privileged endpoints.
 *
 * Fail-closed: an unset token means the route answers 503, so a Pi that never
 * opted in cannot be administered by anyone who reaches it. Set-but-wrong is
 * 401. The two are deliberately distinct — the operator needs to tell "this
 * device has no admin token" from "your token is wrong".
 *
 * The token is passed IN rather than read from `process.env` here, matching
 * `resolveTileHealth(root, env)`: the caller owns the env lookup, so a test
 * calls this with a bare string and no mocking.
 *
 * Returns a `Response` to send, or `null` to proceed. It does not throw:
 * `error()` from @sveltejs/kit only unwinds inside a request cycle, and every
 * server helper in aero-2 is callable from a test with a bare `Request`.
 */

import { timingSafeEqual } from 'node:crypto';

/**
 * Validates `Authorization: Bearer <token>` against `expected`.
 *
 * `label` names the gate in the 503 body, so an operator seeing the refusal
 * knows which token is missing when several gates coexist.
 */
export function requireBearer(
	request: Request,
	expected: string | undefined,
	label: string
): Response | null {
	if (!expected) {
		return json(503, `${label} disabled: token not configured`);
	}

	const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i);
	const presented = match?.[1]?.trim();

	if (!presented || !constantTimeEquals(presented, expected)) {
		return json(401, 'invalid bearer token');
	}

	return null;
}

/**
 * Constant-time compare. `===` leaks the token byte-by-byte through response
 * timing. `timingSafeEqual` throws on unequal lengths, so the length check is
 * required rather than an optimisation — it leaks only "wrong length", which is
 * fine for a fixed-length per-deployment token.
 */
function constantTimeEquals(a: string, b: string): boolean {
	const ab = Buffer.from(a, 'utf8');
	const bb = Buffer.from(b, 'utf8');
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

function json(status: number, message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}
