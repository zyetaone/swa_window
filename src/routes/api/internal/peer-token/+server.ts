/**
 * GET /api/internal/peer-token — localhost-only fetch of AERO_ADMIN_TOKEN.
 *
 * Contract: callers must originate from 127.0.0.1 or ::1 (i.e. the kiosk
 * browser running on the same Pi as this server). Anything else gets a flat
 * 403, including LAN peers reaching us by *.local hostname. The check is on
 * the connecting socket address, not the Origin header — Origin can be
 * spoofed by curl, but a remote socket address cannot.
 *
 * Why this exists: peer-sync needs to send authenticated PATCH /api/config
 * requests to neighbour Pis, but the kiosk browser has no operator typing in
 * an admin token. The kiosk IS same-origin to its local Node server, so it
 * can fetch this endpoint and cache the token in memory. LAN guests
 * (admin laptop, other Pis hitting THIS Pi from off-box) are cross-origin
 * and blocked at the socket-address check, so the token never leaks beyond
 * the kiosk browser of the Pi that holds it in env.
 *
 * Fail-closed: 503 when AERO_ADMIN_TOKEN is unset, matching the pattern in
 * $lib/http/auth.ts.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const LOCALHOST = new Set(['127.0.0.1', '::1']);

export const GET: RequestHandler = async ({ getClientAddress }) => {
	const addr = getClientAddress();
	if (!LOCALHOST.has(addr)) {
		throw error(403, 'forbidden: localhost only');
	}

	const token = process.env.AERO_ADMIN_TOKEN;
	if (!token) {
		throw error(503, 'peer token disabled: AERO_ADMIN_TOKEN not set');
	}

	return json(
		{ token },
		{ headers: { 'Cache-Control': 'no-store' } },
	);
};

// No CORS — same-origin only. Explicit OPTIONS denies preflight for any
// cross-origin caller, so browsers reject the request before issuing GET.
export const OPTIONS: RequestHandler = async () => {
	throw error(403, 'forbidden: localhost only');
};
