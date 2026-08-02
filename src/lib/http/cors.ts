/**
 * LAN-scoped CORS helper.
 *
 * Policy: allow cross-origin requests only from origins that match the
 * LAN-local pattern (*.local optionally with a port, or localhost). This
 * covers:
 *   - Admin dashboards on a laptop (http://admin-laptop.local:5173)
 *   - Pi-to-Pi bundle proxying (http://aero-display-01.local)
 *   - Dev machines (http://localhost:5173)
 *
 * Requests with NO Origin header (same-origin fetches, curl, Pi health-check
 * shell scripts) are not cross-origin at all — no CORS header is needed and
 * none is added.
 *
 * Requests from any other origin receive no CORS headers, which causes the
 * browser to block the response. We do not return a 403 — silence is correct
 * here so that the endpoint still works for same-origin callers.
 */

/** Matches *.local (with optional port) and localhost (with optional port). */
const LAN_ORIGIN = /^https?:\/\/([a-zA-Z0-9-]+\.local|localhost)(:[0-9]{1,5})?$/;

/**
 * Returns CORS headers appropriate for the incoming request's Origin.
 *
 * @param requestOrigin - The value of the incoming `Origin` header, or null/
 *   undefined when absent.
 * @returns A plain object with zero or more `Access-Control-*` entries to
 *   spread into a response `headers` object. Never mutates the input.
 */
export function lanCorsHeaders(requestOrigin: string | null | undefined): Record<string, string> {
	if (!requestOrigin || !LAN_ORIGIN.test(requestOrigin)) {
		// No origin or non-LAN origin: emit no CORS headers.
		return {};
	}
	// Reflect the exact origin back (required when credentials are involved,
	// and also tighter than a wildcard even when they are not).
	return {
		'Access-Control-Allow-Origin': requestOrigin,
		'Vary': 'Origin',
	};
}

/**
 * Full preflight + regular CORS headers for endpoints that accept POST / PUT.
 * Same LAN-allowlist logic as lanCorsHeaders, with the extra preflight fields.
 */
export function lanCorsHeadersFull(
	requestOrigin: string | null | undefined,
	methods = 'GET, POST, OPTIONS',
): Record<string, string> {
	const base = lanCorsHeaders(requestOrigin);
	if (Object.keys(base).length === 0) return {};
	return {
		...base,
		'Access-Control-Allow-Methods': methods,
		// `Authorization` is REQUIRED here, not optional. Every mutating route
		// behind this preflight is bearer-gated (publishRoute → requireAdminToken),
		// and the admin dashboard reaches peer Pis cross-origin
		// (admin-laptop.local → aero-display-01.local). Omitting it makes the
		// browser fail the preflight and drop the request before it is ever sent,
		// so cross-device pushes silently no-op while same-origin curl works —
		// which is exactly why this went unnoticed.
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	};
}

/**
 * Build a SvelteKit RequestHandler that answers CORS preflight with the
 * supplied methods. Eliminates the 5-line OPTIONS boilerplate at every
 * mutating API route.
 *
 *   export const OPTIONS = corsPreflight('PATCH, OPTIONS');
 */
export function corsPreflight(methods: string): (event: { request: Request }) => Response {
	return ({ request }) => new Response(null, {
		status: 204,
		headers: lanCorsHeadersFull(request.headers.get('origin'), methods),
	});
}
