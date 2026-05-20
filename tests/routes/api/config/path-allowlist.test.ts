/**
 * PATCH /api/config — path allowlist (defense in depth alongside the
 * setByPath __proto__ / constructor / prototype rejection on the browser).
 * The route doesn't actually mutate state — it publishes to the SSE bus —
 * but a malicious path string could reach a future setByPath bug. Pin the
 * server-side gate so that surface is closed at the wire.
 *
 * Test focus: shape of accepted vs rejected paths. We mock the SSE bus
 * publish() so the test stays purely about route gating.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock factories are hoisted above imports; vi.hoisted lets the spy
// reference survive that hoisting.
const { publishSpy } = vi.hoisted(() => ({ publishSpy: vi.fn() }));
vi.mock('$lib/fleet/sse-bus.server', () => ({
	publish: publishSpy,
	subscribe: vi.fn(),
	subscriberCount: vi.fn(() => 0),
}));

import { PATCH } from '../../../../src/routes/api/config/+server';

const TOKEN = 'admin-test-token';

function call(body: unknown): Promise<Response> {
	const req = new Request('http://x.local/api/config', {
		method: 'PATCH',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${TOKEN}`,
		},
		body: JSON.stringify(body),
	});
	return PATCH({ request: req } as unknown as Parameters<typeof PATCH>[0]) as Promise<Response>;
}

beforeEach(() => {
	publishSpy.mockClear();
	process.env.AERO_ADMIN_TOKEN = TOKEN;
});

afterEach(() => {
	delete process.env.AERO_ADMIN_TOKEN;
});

describe('PATCH /api/config — path allowlist', () => {
	it('accepts allowed namespace paths', async () => {
		for (const path of [
			'atmosphere.clouds.density',
			'camera.parallax.role',
			'director.autopilot.enabled',
			'world.qualityMode',
			'shell.windowFrame',
		]) {
			const res = await call({ path, value: 1, timestamp: 1, sourceId: 's' });
			expect(res.status).toBe(200);
		}
		expect(publishSpy).toHaveBeenCalledTimes(5);
	});

	it('rejects __proto__ as a path prefix (400)', async () => {
		await expect(call({ path: '__proto__.polluted', value: 'pwned' })).rejects.toMatchObject({ status: 400 });
		expect(publishSpy).not.toHaveBeenCalled();
	});

	it('rejects __proto__ as an interior segment (400)', async () => {
		await expect(call({ path: 'atmosphere.__proto__.x', value: 1 })).rejects.toMatchObject({ status: 400 });
	});

	it('rejects constructor.prototype-style attack (400)', async () => {
		await expect(call({ path: 'constructor.prototype.x', value: 1 })).rejects.toMatchObject({ status: 400 });
	});

	it('rejects paths outside the namespace allowlist (400)', async () => {
		await expect(call({ path: 'unknown.field', value: 1 })).rejects.toMatchObject({ status: 400 });
		await expect(call({ path: 'process.env.foo', value: 1 })).rejects.toMatchObject({ status: 400 });
	});

	it('rejects paths with non-identifier segments (400)', async () => {
		await expect(call({ path: 'atmosphere.clouds-density', value: 1 })).rejects.toMatchObject({ status: 400 });
		await expect(call({ path: 'atmosphere.', value: 1 })).rejects.toMatchObject({ status: 400 });
		await expect(call({ path: '', value: 1 })).rejects.toMatchObject({ status: 400 });
	});

	it('rejects single-segment paths (must have at least <ns>.<key>)', async () => {
		await expect(call({ path: 'atmosphere', value: 1 })).rejects.toMatchObject({ status: 400 });
	});

	it('rejects non-string path (400)', async () => {
		await expect(call({ path: 42, value: 1 })).rejects.toMatchObject({ status: 400 });
		await expect(call({ value: 1 })).rejects.toMatchObject({ status: 400 });
	});

	it('rejects unauthenticated requests (401) — bearer gate runs before path validation', async () => {
		const req = new Request('http://x.local/api/config', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ path: 'atmosphere.clouds.density', value: 1 }),
		});
		await expect(
			PATCH({ request: req } as unknown as Parameters<typeof PATCH>[0]) as Promise<Response>,
		).rejects.toMatchObject({ status: 401 });
		expect(publishSpy).not.toHaveBeenCalled();
	});

	it('fails closed (503) when AERO_ADMIN_TOKEN is unset', async () => {
		delete process.env.AERO_ADMIN_TOKEN;
		await expect(call({ path: 'atmosphere.clouds.density', value: 1 })).rejects.toMatchObject({ status: 503 });
		expect(publishSpy).not.toHaveBeenCalled();
	});
});
