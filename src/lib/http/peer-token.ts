/**
 * Browser-side helper that pulls the peer-sync bearer token from the local
 * Pi server's localhost-only endpoint and caches it in memory.
 *
 * Caching contract:
 *   - First successful fetch is cached for the lifetime of the tab (module
 *     state, never invalidated). The token only changes when the Pi
 *     restarts with a new AERO_ADMIN_TOKEN env var, in which case the
 *     browser is reloading anyway.
 *   - Concurrent callers during the initial fetch share one in-flight
 *     promise, so we never issue two simultaneous GETs.
 *   - A 403 or 503 response (token disabled, or somehow not localhost) is
 *     cached as null. peer-sync then silently no-ops on the auth header,
 *     which causes downstream /api/config PATCHes to be rejected by the
 *     receiving peer with 401 / 503 — that's the correct behaviour on a
 *     Pi with no AERO_ADMIN_TOKEN set: peer-sync is simply disabled.
 *
 * Why no localStorage: the kiosk Pi browser is the only caller. sessionStorage
 * survives reloads we don't need; localStorage would leak the token across
 * profiles. Module memory is enough.
 */

let cached: string | null = null;
let pending: Promise<string | null> | null = null;
let resolved = false;

async function fetchPeerToken(): Promise<string | null> {
	try {
		const res = await fetch('/api/internal/peer-token', { cache: 'no-store' });
		if (!res.ok) return null;
		const body = (await res.json()) as { token?: unknown };
		return typeof body.token === 'string' && body.token.length > 0 ? body.token : null;
	} catch {
		return null;
	}
}

export async function getPeerToken(): Promise<string | null> {
	if (resolved) return cached;
	if (pending) return pending;
	pending = fetchPeerToken().then((token) => {
		cached = token;
		resolved = true;
		pending = null;
		return token;
	});
	return pending;
}

export async function peerAuthHeader(): Promise<HeadersInit> {
	const token = await getPeerToken();
	if (!token) return {};
	return { Authorization: `Bearer ${token}` };
}

/**
 * Test-only reset hook. Module state is per-process, so unit tests need a
 * way to drop the cache between cases. Not used by production code.
 */
export function __resetPeerTokenCacheForTests(): void {
	cached = null;
	pending = null;
	resolved = false;
}
