/**
 * /api/wifi/reset — auth gate + the recovery-path guard.
 *
 * Both of this handler's side-effecting dependencies branch on
 * `process.platform`, which made this suite host-dependent and turned CI red
 * the moment the recovery guard landed:
 *
 *   - `wifiRecoveryAvailable()` short-circuits to ok:true off Linux, but
 *     existsSync-checks the portal unit + binary ON Linux. The 200-path
 *     assertions therefore passed on a macOS dev host and returned 503 on CI's
 *     Ubuntu runner, where neither file exists.
 *   - `schedulePrivileged()` is a warn-and-no-op off Linux, but on Linux it
 *     preflights `sudo -n true` — which SUCCEEDS on a GitHub runner. The suite
 *     was really scheduling `nmcli … && sudo -n /sbin/reboot` 2s out on every
 *     CI run, saved only by `nmcli` being absent so the `|| exit 1` fired.
 *
 * Fix: pin `process.platform` per test rather than inheriting the host's.
 * Each test then exercises one specific branch identically everywhere, and
 * no test can reach the real spawn — the Linux tests all stop at the guard,
 * the non-Linux tests all stop at schedulePrivileged's no-op. No mocking of
 * node:fs or node:child_process is needed, and none is attempted: `$lib` and
 * `node:fs` both resolve to different module ids under vitest than the route
 * imports, so mocks registered on them silently never bind.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from '../../../../src/routes/api/wifi/reset/+server';
// Not exported from +server.ts: SvelteKit restricts route exports to a fixed
// list and rejects anything else at BUILD time — which neither svelte-check nor
// vitest exercises, so it shipped green and broke CI one step later.
import { wifiRecoveryAvailable } from '$lib/server/wifi-recovery';

const TOKEN = 'sekret-token-for-tests';

const realPlatform = process.platform;
function setPlatform(p: NodeJS.Platform) {
	Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

beforeEach(() => {
	delete process.env.AERO_WIFI_RESET_TOKEN;
	// Default to the non-Linux branch: guard short-circuits, schedulePrivileged
	// no-ops, so the auth logic below is what's actually under test.
	setPlatform('darwin');
});

afterEach(() => {
	delete process.env.AERO_WIFI_RESET_TOKEN;
	setPlatform(realPlatform);
});

function call(headers: Record<string, string> = {}) {
	const request = new Request('http://localhost/api/wifi/reset', {
		method: 'POST',
		headers,
	});
	// SvelteKit's RequestEvent has many fields; the handler only reads .request.
	return POST({ request } as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/wifi/reset — auth', () => {
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
		expect(await res.json()).toMatchObject({ ok: true });
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
 *
 * These pin platform to linux and use the REAL filesystem: neither a macOS dev
 * host nor a CI runner has /etc/systemd/system/aero-wifi-portal.service, so the
 * missing-portal branch is deterministic on both without any mock. That is also
 * the state of a fielded Pi today, which is the whole reason the guard exists.
 */
describe('POST /api/wifi/reset — recovery guard', () => {
	it('refuses (503) when the portal unit is absent, rather than purging', async () => {
		setPlatform('linux');
		process.env.AERO_WIFI_RESET_TOKEN = TOKEN;
		const res = await call({ authorization: `Bearer ${TOKEN}` });
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.ok).toBe(false);
		// The operator must learn WHICH piece is missing, not just "no".
		expect(body.message).toMatch(/aero-wifi-portal\.service|wifi-connect/);
	});

	it('names the missing component so the 503 is actionable', () => {
		setPlatform('linux');
		const r = wifiRecoveryAvailable();
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/aero-wifi-portal\.service|wifi-connect/);
	});

	it('short-circuits to available off Linux — no purge is possible there', () => {
		// schedulePrivileged is already a warn-and-no-op off Linux, so there is
		// nothing to protect and the dev/test path must stay unblocked.
		expect(wifiRecoveryAvailable().ok).toBe(true);
	});
});
