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

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	recordHeartbeat,
	historyForDevice,
	latestAll,
	summarize,
	DEVICE_ID_PATTERN,
} from '$lib/fleet/heartbeat.server';
import { readLimitedJson } from '$lib/http/body';
import { lanCorsHeadersFull, corsPreflight } from '$lib/http/cors';

// 64 KB — heartbeat payload is { deviceId, role, groupId, fps, temp, uptime,
// crashCount }; 64 KB is 100× the realistic size yet still a tight DoS bound.
const MAX_HEARTBEAT_BYTES = 64 * 1024;

export const OPTIONS: RequestHandler = corsPreflight('GET, POST, OPTIONS');

export const POST: RequestHandler = async ({ request }) => {
	const cors = lanCorsHeadersFull(request.headers.get('Origin'));
	const body = await readLimitedJson<unknown>(request, MAX_HEARTBEAT_BYTES);
	const sample = recordHeartbeat(body);
	if (!sample) {
		throw error(400, 'invalid payload');
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
			throw error(400, 'invalid deviceId');
		}
		return json(historyForDevice(deviceId), { headers: cors });
	}
	return json(latestAll(), { headers: cors });
};
