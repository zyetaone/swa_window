/**
 * Fleet heartbeat endpoint.
 *
 * POST /api/fleet/heartbeat
 *   Body: { deviceId, role, groupId, fps, temp, uptime, crashCount }
 *   Each Pi hits this every 60s via deploy/pi/health-check.sh.
 *   Payload is validated by recordHeartbeat() — bad input → 400.
 *
 * GET /api/fleet/heartbeat
 *   ?deviceId=<id>  → full history for that device (up to 500 samples)
 *   (no params)     → latest sample from every known device
 *   ?summary        → fleet rollup (total, online, offline, avgFps, maxTempC)
 *
 * All responses carry permissive CORS headers so the admin dashboard can
 * live on a different origin (e.g. a laptop on the LAN).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	recordHeartbeat,
	historyForDevice,
	latestAll,
	summarize,
} from '$lib/fleet/heartbeat.server';
import { lanCorsHeadersFull, corsPreflight } from '$lib/http/cors';

// Same shape as the deviceId allowlist in heartbeat.server.recordHeartbeat —
// keeps GET-by-id queries consistent with what POST will accept, and avoids
// trusting an arbitrary string for a Map.get on the server side.
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

export const OPTIONS: RequestHandler = corsPreflight('GET, POST, OPTIONS');

export const POST: RequestHandler = async ({ request }) => {
	const cors = lanCorsHeadersFull(request.headers.get('Origin'));
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid json' }, { status: 400, headers: cors });
	}
	const sample = recordHeartbeat(body);
	if (!sample) {
		return json({ error: 'invalid payload' }, { status: 400, headers: cors });
	}
	return json({ ok: true, receivedAt: sample.receivedAt }, { headers: cors });
};

export const GET: RequestHandler = async ({ url, request }) => {
	const cors = lanCorsHeadersFull(request.headers.get('Origin'));
	if (url.searchParams.has('summary')) {
		return json(summarize(), { headers: cors });
	}
	const deviceId = url.searchParams.get('deviceId');
	if (deviceId) {
		if (!DEVICE_ID_PATTERN.test(deviceId)) {
			return json({ error: 'invalid deviceId' }, { status: 400, headers: cors });
		}
		return json(historyForDevice(deviceId), { headers: cors });
	}
	return json(latestAll(), { headers: cors });
};
