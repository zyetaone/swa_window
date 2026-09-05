import { describe, it, expect, vi } from 'vitest';

/**
 * `schedulePrivileged` is mocked because this suite tests the AUTH GATE, not the
 * OS hatch. Unmocked it consults the ambient machine: on darwin it no-ops and
 * returns true, on Linux it runs a real `sudo -n true` preflight that fails in
 * any container, and the route then correctly answers 503 instead of 202. So
 * the 202 assertion below passed on the author's laptop and failed on the CI
 * runner while both the route and the helper were entirely correct — a test
 * asserting a property of the host rather than of the code.
 *
 * The helper keeps its own coverage in privileged.test.ts, which is where the
 * platform branch belongs.
 */
vi.mock('#lib/server/privileged.js', () => ({ schedulePrivileged: () => true }));

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
