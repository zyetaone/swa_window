/**
 * /api/wifi/reset auth gate.
 *
 * The handler shells out to nmcli + reboot on Linux. On the macOS test
 * host the body's `scheduleReset()` is a no-op (`platform !== 'linux'`
 * early return) so we can safely assert the 200 path without touching
 * networking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from '../../../../src/routes/api/wifi/reset/+server';

const TOKEN = 'sekret-token-for-tests';

beforeEach(() => {
	delete process.env.AERO_WIFI_RESET_TOKEN;
});

afterEach(() => {
	delete process.env.AERO_WIFI_RESET_TOKEN;
});

function call(headers: Record<string, string> = {}) {
	const request = new Request('http://localhost/api/wifi/reset', {
		method: 'POST',
		headers,
	});
	// SvelteKit's RequestEvent has many fields; the handler only reads .request.
	return POST({ request } as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/wifi/reset', () => {
	it('fails closed (503) when AERO_WIFI_RESET_TOKEN is unset', async () => {
		await expect(call({ authorization: `Bearer ${TOKEN}` })).rejects.toMatchObject({ status: 503 });
	});

	it('rejects requests with no Authorization header (401)', async () => {
		process.env.AERO_WIFI_RESET_TOKEN = TOKEN;
		await expect(call({})).rejects.toMatchObject({ status: 401 });
	});

	it('rejects malformed Authorization headers (401)', async () => {
		process.env.AERO_WIFI_RESET_TOKEN = TOKEN;
		await expect(call({ authorization: 'Token ' + TOKEN })).rejects.toMatchObject({ status: 401 });
	});

	it('rejects mismatched tokens (401)', async () => {
		process.env.AERO_WIFI_RESET_TOKEN = TOKEN;
		await expect(call({ authorization: 'Bearer wrong' })).rejects.toMatchObject({ status: 401 });
	});

	it('rejects tokens of matching length but different bytes (constant-time path)', async () => {
		process.env.AERO_WIFI_RESET_TOKEN = TOKEN;
		const sameLen = 'X'.repeat(TOKEN.length);
		await expect(call({ authorization: `Bearer ${sameLen}` })).rejects.toMatchObject({ status: 401 });
	});

	it('accepts the correct bearer token (200)', async () => {
		process.env.AERO_WIFI_RESET_TOKEN = TOKEN;
		const res = await call({ authorization: `Bearer ${TOKEN}` });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({ ok: true });
	});

	it('Bearer prefix is case-insensitive', async () => {
		process.env.AERO_WIFI_RESET_TOKEN = TOKEN;
		const res = await call({ authorization: `bearer ${TOKEN}` });
		expect(res.status).toBe(200);
	});
});
