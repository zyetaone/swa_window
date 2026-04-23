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
import { lanCorsHeaders, lanCorsHeadersFull } from '$lib/http/cors';
import { getDeviceStatus, setDeviceStatus, type DeviceStatus } from '$lib/fleet/device-registry.server';

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, {
		status: 204,
		headers: lanCorsHeadersFull(request.headers.get('origin'), 'GET, POST, OPTIONS'),
	});
};

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

export const POST: RequestHandler = async ({ request }) => {
	// Same-origin heartbeat from the local browser. No CORS — the browser
	// uses fetch('/api/status', ...) which is same-origin.
	const body = await readLimitedJson<DeviceStatus>(request, 2048);
	if (!body || typeof body.deviceId !== 'string') {
		throw error(400, 'invalid status body');
	}
	setDeviceStatus(body);
	return json({ ok: true });
};
