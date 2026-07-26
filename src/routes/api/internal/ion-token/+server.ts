/**
 * GET /api/internal/ion-token — localhost-only fetch of the Cesium Ion token.
 *
 * Same contract as /api/internal/peer-token: the connecting socket must be
 * 127.0.0.1 / ::1 (the kiosk browser on this Pi). Anything else gets 403.
 * The check is the socket address, not Origin — Origin is spoofable by curl,
 * a remote socket address is not.
 *
 * Why this exists: `VITE_CESIUM_ION_TOKEN` is INLINED INTO THE CLIENT BUNDLE
 * at build time. Two consequences that this endpoint removes:
 *
 *   1. Anyone who can load `/` can read the token out of the JS. Today that's
 *      the LAN; it becomes the whole internet the moment CI publishes a build
 *      artifact from this PUBLIC repo.
 *   2. The token has to exist on every device AT BUILD TIME, which is a large
 *      part of why each Pi compiles locally instead of consuming a prebuilt
 *      artifact.
 *
 * Serving it at runtime instead means the build output carries no secret, so
 * it can be built once in CI and shipped to the fleet, and the token lives
 * only in each Pi's /etc/aero/config.env.
 *
 * Reads CESIUM_ION_TOKEN (server-side, deliberately NOT the VITE_ name — a
 * VITE_-prefixed var would be inlined again and defeat the point).
 *
 * Fail-closed: 503 when unset. Cesium then runs without Ion (no Ion terrain
 * or imagery) rather than the app failing to boot — matching getIonToken()'s
 * existing null contract.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const LOCALHOST = new Set(['127.0.0.1', '::1']);

export const GET: RequestHandler = async ({ getClientAddress }) => {
	const addr = getClientAddress();
	if (!LOCALHOST.has(addr)) {
		throw error(403, 'forbidden: localhost only');
	}

	const token = process.env.CESIUM_ION_TOKEN;
	if (!token) {
		throw error(503, 'ion token disabled: CESIUM_ION_TOKEN not set');
	}

	return json({ token }, { headers: { 'Cache-Control': 'no-store' } });
};

// No CORS — same-origin only. Explicit OPTIONS denies preflight so browsers
// reject any cross-origin attempt before the GET is issued.
export const OPTIONS: RequestHandler = async () => {
	throw error(403, 'forbidden: localhost only');
};
