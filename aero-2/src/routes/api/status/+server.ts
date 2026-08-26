import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import os from 'node:os';

/**
 * GET /api/status — returns device telemetry, hostname, and all active local IPv4 LAN addresses.
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

	return json({
		online: true,
		hostname: os.hostname(),
		platform: os.platform(),
		arch: os.arch(),
		uptimeSec: os.uptime(),
		loadAvg: os.loadavg(),
		freeMemBytes: os.freemem(),
		totalMemBytes: os.totalmem(),
		lanIps,
		allIps: ipAddresses,
		primaryLanIp: lanIps[0]?.address ?? 'localhost',
		port: 5173
	});
};
