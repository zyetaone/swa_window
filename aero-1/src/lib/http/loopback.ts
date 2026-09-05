/**
 * Loopback detection for localhost-only endpoints.
 *
 * WHY THIS EXISTS: `getClientAddress()` does NOT always return the literal
 * '127.0.0.1'. When Node accepts an IPv4 connection on a dual-stack socket
 * it reports the IPv4-mapped IPv6 form '::ffff:127.0.0.1'. So a caller that
 * dialled http://127.0.0.1:5173 fails a naive `addr === '127.0.0.1'` check
 * while http://localhost:5173 (which resolves to ::1) passes — the same
 * machine, the same trust level, two different answers.
 *
 * That asymmetry is a real hazard on the Pi: /api/internal/token is the
 * kiosk's only source of the Ion token, and the kiosk URL is operator
 * configuration. Point it at 127.0.0.1 instead of localhost and the device
 * boots with no terrain/imagery token and no obvious cause.
 *
 * Loopback is also the whole security boundary for these routes, so the
 * check must stay strict: only the three loopback spellings, never a
 * prefix match (a '127.' startsWith test would accept a forwarded
 * X-Forwarded-For style value, and '::ffff:127.0.0.1.evil.com' must not
 * pass either).
 */

/** Exact loopback spellings, including the IPv4-mapped IPv6 form. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * True when the socket address is this machine talking to itself.
 * Pass the value of SvelteKit's `getClientAddress()`.
 */
export function isLoopback(addr: string): boolean {
	return LOOPBACK.has(addr);
}
