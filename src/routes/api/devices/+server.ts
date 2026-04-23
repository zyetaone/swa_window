/**
 * GET /api/devices — mDNS-discovered peer list + this device itself.
 *
 * Admin panel calls this (same-origin on the Pi it's loaded from) to
 * enumerate the other Pis on the LAN. Returns `{ deviceId, host, port }`
 * entries; admin then directly fetch()es each peer's REST endpoints.
 *
 * Replaces the WS-broker device registry with the mDNS primitive that's
 * already in lan-peers.server.ts — no central state required.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { lanCorsHeaders } from '$lib/http/cors';
import { listPeers } from '$lib/fleet/lan-peers.server';

export const GET: RequestHandler = ({ request, url }) => {
	const origin = request.headers.get('origin');
	const peers = listPeers();

	// Include self (the Pi serving this request) so admin UI can show it too.
	const selfHost = url.hostname;
	const selfPort = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
	const self = {
		deviceId: process.env.AERO_DEVICE_ID ?? process.env.HOSTNAME ?? selfHost,
		host: selfHost,
		port: selfPort,
		self: true,
	};

	return json(
		{ devices: [self, ...peers] },
		{ headers: lanCorsHeaders(origin) },
	);
};
