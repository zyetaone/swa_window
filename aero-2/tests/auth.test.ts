import { describe, it, expect } from 'vitest';
import { requireBearer } from '#lib/server/auth.js';

const req = (auth?: string) =>
	new Request('http://pane/api/admin', { headers: auth ? { authorization: auth } : {} });

describe('requireBearer', () => {
	it('returns null — proceed — for the right token', () => {
		expect(requireBearer(req('Bearer s3cret'), 's3cret', 'admin')).toBeNull();
	});

	/**
	 * Fail-closed. A Pi that was never given a token must not be administrable
	 * by whoever reaches it, and 503 (not 401) tells the operator the device is
	 * unconfigured rather than that they typed the token wrong.
	 */
	it('refuses with 503 when no token is configured', async () => {
		const res = requireBearer(req('Bearer anything'), undefined, 'admin');
		expect(res?.status).toBe(503);
		expect(await res!.json()).toMatchObject({ error: expect.stringContaining('admin') });
	});

	it('refuses with 401 for a wrong or missing token', () => {
		expect(requireBearer(req('Bearer wrong'), 's3cret', 'admin')?.status).toBe(401);
		expect(requireBearer(req(), 's3cret', 'admin')?.status).toBe(401);
		expect(requireBearer(req('s3cret'), 's3cret', 'admin')?.status).toBe(401);
		expect(requireBearer(req('Basic s3cret'), 's3cret', 'admin')?.status).toBe(401);
	});

	/**
	 * timingSafeEqual throws on unequal-length buffers, so a length mismatch has
	 * to short-circuit before it. Without that guard this case is a 500, not a
	 * 401 — which is both a worse answer and a louder oracle.
	 */
	it('rejects a token of the wrong length without throwing', () => {
		expect(requireBearer(req('Bearer s'), 's3cret', 'admin')?.status).toBe(401);
		expect(requireBearer(req('Bearer s3cretttttt'), 's3cret', 'admin')?.status).toBe(401);
	});

	it('accepts the header case-insensitively, as HTTP requires', () => {
		expect(requireBearer(req('bearer s3cret'), 's3cret', 'admin')).toBeNull();
	});
});
