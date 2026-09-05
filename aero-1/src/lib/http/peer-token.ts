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
 *   - A TRANSIENT failure (network error, e.g. the fetch races an OTA app
 *     restart) is NOT cached: the next caller retries. Caching it as null
 *     would silently disable peer auth until a full page reload — every
 *     push 401ing forever.
 *
 * Why no localStorage: the kiosk Pi browser is the only caller. sessionStorage
 * survives reloads we don't need; localStorage would leak the token across
 * profiles. Module memory is enough.
 */

import { isLoopback } from './loopback';

let cached: string | null = null;
let pending: Promise<string | null> | null = null;
let resolved = false;

async function fetchPeerToken(): Promise<string | null> {
	// Deliberate null (non-OK: token disabled / not localhost) is cacheable.
	// Network/parse errors THROW so getPeerToken can avoid caching them.
	const res = await fetch('/api/internal/token?type=admin', { cache: 'no-store' });
	if (!res.ok) return null;
	const body = (await res.json()) as { token?: unknown };
	return typeof body.token === 'string' && body.token.length > 0 ? body.token : null;
}

export async function getPeerToken(): Promise<string | null> {
	if (resolved) return cached;
	if (pending) return pending;
	pending = fetchPeerToken().then((token) => {
		cached = token;
		resolved = true;
		pending = null;
		return token;
	}).catch(() => {
		// Transient failure — do NOT cache; the next call retries the fetch.
		pending = null;
		return null;
	});
	return pending;
}

/**
 * True when `host` is an address we trust with the admin bearer token:
 * loopback spellings, `localhost`, or an mDNS `.local` hostname — the only
 * shapes lan-peers discovery legitimately produces (SRV targets are
 * announced as `${deviceHost()}.local`). Anything else (public IP, bare DNS
 * name, a lookalike like `aero-display-01.local.evil.com`) means a rogue
 * mDNS responder pointed us off-LAN, and the token must not be sent.
 * Numeric RFC1918 (192.168.x.x) is deliberately NOT trusted, matching the
 * CORS allowlist policy in ./cors.ts.
 */
export function isLanHost(host: string): boolean {
	// Hostnames are case-insensitive; mDNS targets may carry a trailing
	// root dot (`aero-display-01.local.`).
	const h = host.toLowerCase().replace(/\.$/, '');
	return isLoopback(h) || h === 'localhost' || h.endsWith('.local');
}

export async function peerAuthHeader(host?: string): Promise<HeadersInit> {
	// A peer host we can't place on the LAN gets no bearer token — the
	// request still goes out (unauthenticated), and the receiving end
	// rejects it, same as the token-unavailable path.
	if (host !== undefined && !isLanHost(host)) return {};
	const token = await getPeerToken();
	if (!token) return {};
	return { Authorization: `Bearer ${token}` };
}

/**
 * JSON content-type + peer auth in one call. The fleet REST paths all POST
 * or PATCH JSON bodies with the same header shape — this is the SSOT for
 * that pair so the spread + content-type can't drift across call sites.
 *
 * Pass the target peer's `host` whenever the request leaves this device:
 * the Authorization header is attached only for LAN hosts (see isLanHost),
 * so a spoofed mDNS SRV target can't harvest the admin token. Omitting
 * `host` preserves the legacy always-attach behaviour for same-origin
 * callers.
 */
export async function peerJsonHeaders(host?: string): Promise<HeadersInit> {
	return { 'Content-Type': 'application/json', ...(await peerAuthHeader(host)) };
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
