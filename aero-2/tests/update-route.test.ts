import { describe, it, expect } from 'vitest';
import { POST } from '../src/routes/api/update/+server.js';

const FLEET_ORIGIN = 'http://192.168.1.9:3000';

/**
 * A hand-built Headers, not a Request: the test environment drops `Origin` as a
 * forbidden header name, and every CORS assertion below would then pass against
 * an empty policy for the wrong reason.
 */
const callFrom = (auth: string, origin: string) =>
	POST({
		request: { headers: new Headers({ authorization: auth, origin }) } as Request
	} as Parameters<typeof POST>[0]);

const call = (auth?: string) =>
	POST({
		request: new Request('http://pane/api/update', {
			method: 'POST',
			...(auth ? { headers: { authorization: auth } } : {})
		})
	} as Parameters<typeof POST>[0]);

describe('POST /api/update', () => {
	it('refuses with 503 when AERO_ADMIN_TOKEN is unset', async () => {
		delete process.env.AERO_ADMIN_TOKEN;
		const res = await call('Bearer anything');
		expect(res.status).toBe(503);
		expect((await res.json()).error).toContain('AERO_ADMIN_TOKEN');
	});

	it('refuses with 401 for a wrong or absent token', async () => {
		process.env.AERO_ADMIN_TOKEN = 'admin';
		try {
			expect((await call('Bearer wrong')).status).toBe(401);
			expect((await call()).status).toBe(401);
		} finally {
			delete process.env.AERO_ADMIN_TOKEN;
		}
	});

	/**
	 * Off Linux triggerOtaUpdate is a no-op that reports success, so this asserts
	 * the contract the operator sees — 202 and a message saying what to watch —
	 * without a Pi restarting the suite that is testing it.
	 */
	/**
	 * The refusal has to be readable cross-origin or the admin laptop shows a
	 * network error instead of "your token is wrong" — the same silence the
	 * missing Allow-Headers caused on the preflight.
	 */
	it('refuses readably from a fleet origin', async () => {
		process.env.AERO_ADMIN_TOKEN = 'admin';
		try {
			for (const auth of ['Bearer wrong', 'Bearer admin']) {
				const res = await callFrom(auth, FLEET_ORIGIN);
				expect(res.headers.get('access-control-allow-origin'), `${auth} (${res.status})`).toBe(
					FLEET_ORIGIN
				);
			}
		} finally {
			delete process.env.AERO_ADMIN_TOKEN;
		}
	});

	it('accepts with 202 for the right token', async () => {
		process.env.AERO_ADMIN_TOKEN = 'admin';
		try {
			const res = await call('Bearer admin');
			expect(res.status).toBe(202);
			expect((await res.json()).ok).toBe(true);
		} finally {
			delete process.env.AERO_ADMIN_TOKEN;
		}
	});
});
