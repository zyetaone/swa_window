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

/**
 * How long after its last heartbeat a device still counts as online.
 *
 * Belongs here because it is derived from STATUS_INTERVAL_MS, not chosen
 * independently: 3 min tolerates ~36 consecutive missed 5 s posts, so a Pi
 * riding out a brief LAN partition or a page reload doesn't flicker offline.
 * Was literal-duplicated as ONLINE_MS in the admin health page and
 * ONLINE_THRESHOLD_MS in heartbeat.server.ts — two names, one number, and a
 * dashboard that would silently disagree with the server if either moved.
 */
export const ONLINE_THRESHOLD_MS = 3 * 60_000;
