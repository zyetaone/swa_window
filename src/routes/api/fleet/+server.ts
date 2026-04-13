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

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, { status: 204, headers: CORS });
};

export const GET: RequestHandler = async ({ url }) => {
	if (url.searchParams.has('health')) {
		return json(fleet.getHealth(), { headers: CORS });
	}
	return json(fleet.getDevices(), { headers: CORS });
};

export const POST: RequestHandler = async ({ request, url }) => {
	const body = await request.json();
	const action = url.searchParams.get('action');

	if (action === 'scene') {
		if (body.broadcast) {
			const sent = fleet.broadcastScene(body.location, body.weather);
			return json({ success: true, sentTo: sent }, { headers: CORS });
		}
		const sent = fleet.pushScene(body.deviceId, body.location, body.weather);
		return json({ success: sent }, { headers: CORS });
	}

	if (action === 'mode') {
		const sent = fleet.pushMode(body.deviceId, body.mode, body.payload);
		return json({ success: sent }, { headers: CORS });
	}

	if (action === 'config') {
		const sent = fleet.pushConfig(body.deviceId, body.config);
		return json({ success: sent }, { headers: CORS });
	}

	return json({ error: 'Unknown action' }, { status: 400, headers: CORS });
};
