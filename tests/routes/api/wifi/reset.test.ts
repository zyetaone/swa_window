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

/**
 * The purge is only survivable if something restores connectivity afterwards.
 * install.sh has never installed aero-wifi-portal.service (its unit loop covers
 * xserver/app/kiosk/updater, and the unit lives in deploy/ not deploy/pi/), nor
 * the wifi-connect binary it execs — so on a real Pi this endpoint used to mean
 * purge → reboot → permanently offline, recoverable only by hand at the device.
 */
describe('wifiRecoveryAvailable', () => {
	it('reports available on non-Linux (no purge can happen there anyway)', async () => {
		const { wifiRecoveryAvailable } = await import('../../../../src/routes/api/wifi/reset/+server');
		// schedulePrivileged is a warn-and-no-op off Linux, so there is nothing
		// to protect and the dev/test path must stay unblocked.
		expect(process.platform === 'linux' || wifiRecoveryAvailable().ok).toBe(true);
	});

	it('names the missing component so the 503 is actionable', async () => {
		const { wifiRecoveryAvailable } = await import('../../../../src/routes/api/wifi/reset/+server');
		const r = wifiRecoveryAvailable();
		// On a dev host this is ok:true; on a Linux box without the portal the
		// reason must identify WHICH piece is absent, not just fail.
		if (!r.ok) expect(r.reason).toMatch(/aero-wifi-portal\.service|wifi-connect/);
	});
});
