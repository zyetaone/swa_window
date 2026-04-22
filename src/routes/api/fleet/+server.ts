/**
 * Fleet REST API — SvelteKit server route.
 *
 * GET  /api/fleet              → device list
 * GET  /api/fleet?health       → fleet health + alerts
 * POST /api/fleet/scene        → push scene to device(s)
 * POST /api/fleet/mode         → push display mode
 * POST /api/fleet/config       → push config patch
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fleet } from '$lib/fleet/hub';
import { lanCorsHeadersFull } from '$lib/http/cors';

export const OPTIONS: RequestHandler = async ({ request }) => {
	const cors = lanCorsHeadersFull(request.headers.get('Origin'));
	return new Response(null, { status: 204, headers: cors });
};

export const GET: RequestHandler = async ({ url, request }) => {
	const cors = lanCorsHeadersFull(request.headers.get('Origin'));
	if (url.searchParams.has('health')) {
		return json(fleet.getHealth(), { headers: cors });
	}
	return json(fleet.getDevices(), { headers: cors });
};

export const POST: RequestHandler = async ({ request, url }) => {
	const cors = lanCorsHeadersFull(request.headers.get('Origin'));
	const body = await request.json();
	const action = url.searchParams.get('action');

	if (action === 'scene') {
		if (body.broadcast) {
			const sent = fleet.broadcastScene(body.location, body.weather);
			return json({ success: true, sentTo: sent }, { headers: cors });
		}
		const sent = fleet.pushScene(body.deviceId, body.location, body.weather);
		return json({ success: sent }, { headers: cors });
	}

	if (action === 'mode') {
		const sent = fleet.pushMode(body.deviceId, body.mode, body.payload);
		return json({ success: sent }, { headers: cors });
	}

	if (action === 'config') {
		const sent = fleet.pushConfig(body.deviceId, body.config);
		return json({ success: sent }, { headers: cors });
	}

	return json({ error: 'Unknown action' }, { status: 400, headers: cors });
};
