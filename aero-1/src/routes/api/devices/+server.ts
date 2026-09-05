/**
 * GET /api/devices — mDNS-discovered peer list + this device itself.
 *
 * Admin panel calls this (same-origin on the Pi it's loaded from) to
 * enumerate the other Pis on the LAN. Returns `{ deviceId, host, port }`
 * entries; admin then directly fetch()es each peer's REST endpoints.
 *
 * Replaces the WS-broker device registry with the mDNS primitive that's
 * already in server/fleet/lan-peers.ts — no central state required.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { lanCorsHeaders } from '$lib/http/cors';
import { listPeers, deviceHost } from '$lib/server/fleet/lan-peers';

export const GET: RequestHandler = ({ request, url }) => {
	const origin = request.headers.get('origin');
	const peers = listPeers();

	// Include self (the Pi serving this request) so admin UI can show it too.
	// deviceId shares the mDNS identity chain (deviceHost) so a device never
	// announces itself under one id and reports another.
	const self = {
		deviceId: deviceHost(),
		host: url.hostname,
		port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
		self: true,
	};

	return json(
		{ devices: [self, ...peers] },
		{ headers: lanCorsHeaders(origin) },
	);
};
