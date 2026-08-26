import { describe, it, expect } from 'vitest';
import { GET } from '../src/routes/api/status/+server.js';

async function status() {
	const request = new Request('http://localhost:5173/api/status');
	const res = await GET({ request } as any);
	expect(res.status).toBe(200);
	return res.json();
}

describe('GET /api/status endpoint', () => {
	it('returns network status with local IP addresses and host metrics', async () => {
		const data = await status();
		expect(data.online).toBe(true);
		expect(typeof data.hostname).toBe('string');
		expect(Array.isArray(data.lanIps)).toBe(true);
		expect(typeof data.primaryLanIp).toBe('string');
		expect(typeof data.port).toBe('number');
	});

	/**
	 * The endpoint is unauthenticated and answers anything that can reach the
	 * port, on a client's LAN. It used to hand out `arch`, `platform`, `loadAvg`
	 * and `allIps` — the last including loopback and every internal interface —
	 * none of which /admin rendered. Adding a field here is adding it to a
	 * public fingerprint, so the test is a list of what may leave.
	 */
	it('discloses nothing beyond what the cockpit displays', async () => {
		const data = await status();
		expect(Object.keys(data).sort()).toEqual([
			'freeMemBytes',
			'hostname',
			'lanIps',
			'online',
			'port',
			'primaryLanIp',
			'totalMemBytes',
			'uptimeSec'
		]);
	});

	it('never lists a loopback interface', async () => {
		const data = await status();
		for (const ip of data.lanIps as { address: string }[]) {
			expect(ip.address.startsWith('127.'), ip.address).toBe(false);
		}
	});
});
