/**
 * GET /api/internal/token?type=admin — localhost-only token exposure.
 *
 * The route's contract has three gates:
 *   1. socket address must be loopback (127.0.0.1 or ::1) → otherwise 403
 *   2. ?type= must be cesium|admin → otherwise 400
 *   3. env var must be set → otherwise 503 (fail-closed)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET, OPTIONS } from '../../../../src/routes/api/internal/token/+server';

const TOKEN = 'kiosk-bearer-token';

function call(clientAddress: string, type = 'admin') {
	const request = new Request(`http://localhost/api/internal/token?type=${type}`);
	return GET({
		request,
		url: new URL(request.url),
		getClientAddress: () => clientAddress,
	} as unknown as Parameters<typeof GET>[0]);
}

beforeEach(() => {
	delete process.env.AERO_ADMIN_TOKEN;
	delete process.env.CESIUM_ION_TOKEN;
	// The route falls back to the build-time VITE_ token; blank it so the
	// fail-closed path is testable on machines with a populated .env.
	vi.stubEnv('VITE_CESIUM_ION_TOKEN', '');
});

afterEach(() => {
	delete process.env.AERO_ADMIN_TOKEN;
	delete process.env.CESIUM_ION_TOKEN;
	vi.unstubAllEnvs();
});

describe('GET /api/internal/token', () => {
	it('rejects non-loopback callers with 403', async () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		await expect(call('192.168.1.42')).rejects.toMatchObject({ status: 403 });
		await expect(call('10.0.0.5')).rejects.toMatchObject({ status: 403 });
		await expect(call('aero-display-01.local')).rejects.toMatchObject({ status: 403 });
	});

	it('rejects missing ?type= with 400', async () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		const request = new Request('http://localhost/api/internal/token');
		await expect(GET({
			request,
			url: new URL(request.url),
			getClientAddress: () => '127.0.0.1',
		} as unknown as Parameters<typeof GET>[0])).rejects.toMatchObject({ status: 400 });
	});

	it('fails closed (503) when AERO_ADMIN_TOKEN is unset', async () => {
		await expect(call('127.0.0.1')).rejects.toMatchObject({ status: 503 });
		await expect(call('::1')).rejects.toMatchObject({ status: 503 });
	});

	it('fails closed (503) when CESIUM_ION_TOKEN is unset', async () => {
		await expect(call('127.0.0.1', 'cesium')).rejects.toMatchObject({ status: 503 });
	});

	it('returns admin token to localhost when env is set', async () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		const res = await call('127.0.0.1') as Response;
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.json()).toEqual({ token: TOKEN });
	});

	it('returns cesium token to localhost when env is set', async () => {
		process.env.CESIUM_ION_TOKEN = TOKEN;
		const res = await call('127.0.0.1', 'cesium') as Response;
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ token: TOKEN });
	});

	it('OPTIONS preflight is rejected (no CORS)', async () => {
		const request = new Request('http://localhost/api/internal/token', { method: 'OPTIONS' });
		await expect(
			OPTIONS({ request } as unknown as Parameters<typeof OPTIONS>[0]),
		).rejects.toMatchObject({ status: 403 });
	});
});
