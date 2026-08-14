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
 *   GET is token-free so the admin dashboard can poll it cross-origin
 *   without a bearer; in exchange, internal-only debug fields (lastError
 *   journal lines) are stripped from every GET response.
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
	statsAll,
	summarize,
	DEVICE_ID_PATTERN,
	type HeartbeatSample,
} from '$lib/server/fleet/heartbeat';
import { readLimitedJson } from '$lib/http/body';
import { lanCorsHeadersFull, corsPreflight } from '$lib/http/cors';
import { requireBearerToken } from '$lib/http/auth';

// 64 KB — heartbeat payload is { deviceId, role, groupId, fps, temp, uptime,
// crashCount }; 64 KB is 100× the realistic size yet still a tight DoS bound.
const MAX_HEARTBEAT_BYTES = 64 * 1024;

export const OPTIONS: RequestHandler = corsPreflight('GET, POST, OPTIONS');

export const POST: RequestHandler = async ({ request }) => {
	// Shared LAN secret (AERO_FLEET_TOKEN). Distinct from AERO_ADMIN_TOKEN so
	// health-check.sh / peer-telemetry scripts can have a lower-privilege
	// credential than the admin dashboard.
	requireBearerToken(request, 'AERO_FLEET_TOKEN', 'fleet heartbeat');
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
	// ?stats → per-device p50/p05/min fps + peak temp over the retained window.
	// This is the P8 perf gate read off real field data rather than a bench run;
	// see tools/perf/P8-CHECKLIST.md. Token-free like the rest of GET, and it
	// exposes no debug fields (DeviceStats carries no lastError).
	if (url.searchParams.has('stats')) {
		return json(statsAll(), { headers: cors });
	}
	const deviceId = url.searchParams.get('deviceId');
	if (deviceId) {
		if (!DEVICE_ID_PATTERN.test(deviceId)) {
			throw error(400, 'invalid deviceId');
		}
		return json(stripInternal(historyForDevice(deviceId)), { headers: cors });
	}
	return json(stripInternal(latestAll()), { headers: cors });
};

/**
 * Drop internal-only debug fields from samples served to unauthenticated
 * GET clients. `lastError` carries a raw aero-app journal line — useful on
 * the device itself, but GET is token-free (the admin dashboard polls it
 * cross-origin without a bearer), so it must not leak to any LAN client.
 */
function stripInternal(list: HeartbeatSample[]): HeartbeatSample[] {
	return list.map((s) => {
		const pub = { ...s };
		delete pub.lastError;
		return pub;
	});
}
