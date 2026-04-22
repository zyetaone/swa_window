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
} from '$lib/fleet/heartbeat.svelte';
import { lanCorsHeadersFull } from '$lib/http/cors';

export const OPTIONS: RequestHandler = async ({ request }) =>
	new Response(null, {
		status: 204,
		headers: lanCorsHeadersFull(request.headers.get('Origin')),
	});

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
		return json(historyForDevice(deviceId), { headers: cors });
	}
	return json(latestAll(), { headers: cors });
};
