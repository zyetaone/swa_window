/**
 * Shared fleet cadences.
 *
 * SSOT for "how often does each device poll." Earlier these values were
 * literal-duplicated across client.svelte.ts, rest-admin.svelte.ts, and
 * lan-peers.server.ts — the trio is load-bearing on each other (polling
 * peer discovery faster than mDNS announces is wasteful, slower misses
 * fresh peers) so they have to converge here.
 */

/** Device → server heartbeat POST cadence (POST /api/status every Xms). */
export const STATUS_INTERVAL_MS = 5000;

/**
 * Discovery refresh cadence for admin-side device list AND device-side peer
 * cache (both read /api/devices). MUST match — or lag — the server's mDNS
 * ANNOUNCE_INTERVAL_MS in lan-peers.server.ts, which advertises the same
 * window. Bumping one without the other gives stale peer lists.
 */
export const PEER_REFRESH_INTERVAL_MS = 30_000;
