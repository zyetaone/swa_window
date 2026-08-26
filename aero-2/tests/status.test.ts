import { describe, it, expect } from 'vitest';
import { GET } from '../src/routes/api/status/+server.js';

describe('GET /api/status endpoint', () => {
	it('returns network status with local IP addresses and host metrics', async () => {
		const request = new Request('http://localhost:5173/api/status');
		const res = await GET({ request } as any);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.online).toBe(true);
		expect(typeof data.hostname).toBe('string');
		expect(Array.isArray(data.allIps)).toBe(true);
		expect(typeof data.primaryLanIp).toBe('string');
		expect(data.port).toBe(5173);
	});
});
