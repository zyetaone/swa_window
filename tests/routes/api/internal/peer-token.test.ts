/**
 * GET /api/internal/peer-token — localhost-only token exposure.
 *
 * The route's contract has two gates:
 *   1. socket address must be loopback (127.0.0.1 or ::1) → otherwise 403
 *   2. AERO_ADMIN_TOKEN must be set → otherwise 503 (fail-closed)
 *
 * Both are pinned here so a regression to either check is caught immediately.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET, OPTIONS } from '../../../../src/routes/api/internal/peer-token/+server';

const TOKEN = 'kiosk-bearer-token';

function call(clientAddress: string) {
	const request = new Request('http://localhost/api/internal/peer-token');
	return GET({
		request,
		getClientAddress: () => clientAddress,
	} as unknown as Parameters<typeof GET>[0]);
}

beforeEach(() => {
	delete process.env.AERO_ADMIN_TOKEN;
});

afterEach(() => {
	delete process.env.AERO_ADMIN_TOKEN;
});

describe('GET /api/internal/peer-token', () => {
	it('rejects non-loopback callers with 403 (even before checking env)', async () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		await expect(call('192.168.1.42')).rejects.toMatchObject({ status: 403 });
		await expect(call('10.0.0.5')).rejects.toMatchObject({ status: 403 });
		// Hostname-shaped strings should also fail — the check is exact-match.
		await expect(call('aero-display-01.local')).rejects.toMatchObject({ status: 403 });
	});

	it('fails closed (503) when AERO_ADMIN_TOKEN is unset, even for localhost', async () => {
		await expect(call('127.0.0.1')).rejects.toMatchObject({ status: 503 });
		await expect(call('::1')).rejects.toMatchObject({ status: 503 });
	});

	it('returns the token to 127.0.0.1 when env is set', async () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		const res = await call('127.0.0.1') as Response;
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = await res.json();
		expect(body).toEqual({ token: TOKEN });
	});

	it('returns the token to ::1 when env is set', async () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		const res = await call('::1') as Response;
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ token: TOKEN });
	});

	it('OPTIONS preflight is rejected (no CORS)', async () => {
		const request = new Request('http://localhost/api/internal/peer-token', { method: 'OPTIONS' });
		await expect(
			OPTIONS({ request } as unknown as Parameters<typeof OPTIONS>[0]),
		).rejects.toMatchObject({ status: 403 });
	});
});
