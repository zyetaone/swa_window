/**
 * GET /api/internal/token?type=cesium|admin — localhost-only token fetch.
 *
 * Contract: callers must originate from 127.0.0.1 or ::1 (the kiosk browser
 * on this Pi). Anything else gets 403. The check is on the socket address,
 * not Origin — Origin is spoofable, a remote socket address is not.
 *
 * Why this exists: VITE_ tokens are inlined into the client bundle at build
 * time. Serving at runtime means the build carries no secrets, can be built
 * once in CI and shipped to the fleet, and tokens live only in each Pi's
 * /etc/aero/config.env.
 *
 * ?type=cesium → CESIUM_ION_TOKEN
 * ?type=admin  → AERO_ADMIN_TOKEN
 *
 * Fail-closed: 503 when env var is unset.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const LOCALHOST = new Set(['127.0.0.1', '::1']);

export const GET: RequestHandler = async ({ url, getClientAddress }) => {
	const addr = getClientAddress();
	if (!LOCALHOST.has(addr)) throw error(403, 'forbidden: localhost only');

	const type = url.searchParams.get('type');
	let token: string | undefined;

	if (type === 'cesium') {
		token = process.env.CESIUM_ION_TOKEN || import.meta.env.VITE_CESIUM_ION_TOKEN;
		if (!token) throw error(503, 'CESIUM_ION_TOKEN not set');
	} else if (type === 'admin') {
		token = process.env.AERO_ADMIN_TOKEN;
		if (!token) throw error(503, 'AERO_ADMIN_TOKEN not set');
	} else {
		throw error(400, 'missing or invalid ?type= (cesium|admin)');
	}

	return json({ token }, { headers: { 'Cache-Control': 'no-store' } });
};

export const OPTIONS: RequestHandler = async () => {
	throw error(403, 'forbidden: localhost only');
};
