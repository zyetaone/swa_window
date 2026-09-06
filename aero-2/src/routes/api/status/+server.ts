import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import os from 'node:os';
import type { KioskStatus } from '#lib/status.js';
import { readVitals } from '#lib/server/vitals.js';

/**
 * GET /api/status — kiosk telemetry for the /admin cockpit.
 *
 * Unauthenticated, and answers anything that can reach the port. It used to
 * also return `arch`, `platform`, `loadAvg` and `allIps` — the last of which
 * included loopback and any internal interface. Nothing rendered them; they
 * were a device fingerprint handed to a client LAN for free. What is left is
 * what /admin actually displays.
 */
export const GET: RequestHandler = () => {
	const interfaces = os.networkInterfaces();
	const ipAddresses: { name: string; address: string; family: string }[] = [];

	for (const [name, netList] of Object.entries(interfaces)) {
		if (!netList) continue;
		for (const net of netList) {
			// Include IPv4 addresses (skip internal 127.0.0.1 for the external LAN list, but keep separate)
			if (net.family === 'IPv4' || (net as any).family === 4) {
				ipAddresses.push({
					name,
					address: net.address,
					family: 'IPv4'
				});
			}
		}
	}

	const lanIps = ipAddresses.filter((ip) => !ip.address.startsWith('127.'));

	// Whatever the tab last reported, if it is recent. Spread so the keys are
	// ABSENT rather than undefined when there is no reading — `health-check.sh`
	// greps for `"fps":` and a literal `undefined` is not valid JSON anyway.
	const vitals = readVitals();

	return json({
		online: true,
		hostname: os.hostname(),
		uptimeSec: os.uptime(),
		freeMemBytes: os.freemem(),
		totalMemBytes: os.totalmem(),
		lanIps,
		primaryLanIp: lanIps[0]?.address ?? 'localhost',
		// server.ts reads PORT; hardcoding 5173 here made the two disagree.
		port: Number(process.env.PORT ?? 5173),
		...(vitals ?? {})
	} satisfies KioskStatus);
};
