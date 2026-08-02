/**
 * GET  /api/status — current device status. Read by admin panel polling.
 * POST /api/status — internal: browser pushes its own status (fps, current
 *                    location, mode, etc.) so the server cache stays fresh.
 *
 * The Pi's browser POSTs at ~0.5 Hz (same cadence as the old WS heartbeat).
 * Admin panel polls each device's GET endpoint at a similar rate.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readLimitedJson } from '$lib/http/body';
import { lanCorsHeaders, corsPreflight } from '$lib/http/cors';
import { isLoopback } from '$lib/http/loopback';
import type { DeviceStatus } from '$lib/fleet/protocol';

// In-process device status cache. Single device per Pi server.
let cached: DeviceStatus | null = null;

function getDeviceStatus(): DeviceStatus | null { return cached; }
function setDeviceStatus(status: DeviceStatus): void {
	cached = { ...status, lastSeen: Date.now() };
}

export const OPTIONS: RequestHandler = corsPreflight('GET, POST, OPTIONS');

export const GET: RequestHandler = ({ request }) => {
	const origin = request.headers.get('origin');
	const status = getDeviceStatus();
	if (!status) {
		return json({ online: false }, { headers: lanCorsHeaders(origin) });
	}
	const staleMs = Date.now() - status.lastSeen;
	return json(
		{ ...status, online: staleMs < 10_000, staleMs },
		{ headers: lanCorsHeaders(origin) },
	);
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	// Scope to the Pi's own browser: the device status is local to this
	// server, and a LAN attacker shouldn't be able to poison the admin
	// dashboard's view of any Pi. Browser POSTs are same-origin and hit
	// the server on localhost. Remote IPs (LAN attackers) get 403.
	if (!isLoopback(getClientAddress())) {
		throw error(403, 'forbidden: localhost only');
	}
	// Same-origin heartbeat from the local browser. No CORS — the browser
	// uses fetch('/api/status', ...) which is same-origin.
	const body = await readLimitedJson<DeviceStatus>(request, 4096);
	if (!body || typeof body.deviceId !== 'string') {
		throw error(400, 'invalid status body');
	}
	setDeviceStatus(body);
	return json({ ok: true });
};
