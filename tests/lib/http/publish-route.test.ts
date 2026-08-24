// @vitest-environment node

/**
 * publishRoute — the shared body behind PATCH /api/config and POST /api/command.
 *
 * Untested until now, which is the wrong shape for what it is: it is the ONE
 * gate every admin→Pi state change goes through, and its own header names the
 * failure it exists to prevent — "a different body cap, a forgotten CORS
 * header, an auth check that moves below the parse — is a security difference
 * that no test would have caught, since both routes would still return 200."
 *
 * So these assert the properties, not the 200. The ordering test in particular
 * is the one a status-code test cannot express.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { publishSpy } = vi.hoisted(() => ({ publishSpy: vi.fn() }));
vi.mock('$lib/server/fleet/sse-bus', () => ({
	publish: publishSpy,
	subscribe: vi.fn(),
	subscriberCount: vi.fn(() => 0),
}));

import { publishRoute } from '$lib/http/publish-route';

const TOKEN = 'admin-test-token';
const auth = (t = TOKEN) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

beforeEach(() => { process.env.AERO_ADMIN_TOKEN = TOKEN; publishSpy.mockClear(); });
afterEach(() => { delete process.env.AERO_ADMIN_TOKEN; });

describe('auth runs BEFORE the body is read', () => {
	it('answers 401, not 400, when BOTH the token and the JSON are bad', async () => {
		// THE ordering property, and the only way to observe it from outside:
		// a request that would fail EITHER check reports whichever check ran
		// first. Auth first -> 401. Parser first -> 400. If requireAdminToken
		// ever slides below readLimitedJson, an unauthenticated caller gets to
		// feed the parser before anything checks who they are, and this flips.
		const handler = publishRoute(() => ({ type: 'noop' }) as never);
		const req = new Request('http://x.local/api/command', {
			method: 'POST', headers: auth('nope'), body: '{ not json',
		});
		await expect(handler({ request: req })).rejects.toMatchObject({ status: 401 });
		expect(publishSpy).not.toHaveBeenCalled();
	});

	it('answers 401, not 413, when BOTH the token and the size are bad', async () => {
		// Same probe against the other body failure. Together these pin the
		// order without needing to observe the stream — which is not
		// observable anyway, since undici buffers the body regardless.
		const handler = publishRoute(() => ({ type: 'noop' }) as never);
		const req = new Request('http://x.local/api/command', {
			method: 'POST', headers: auth('nope'),
			body: JSON.stringify({ pad: 'x'.repeat(5000) }),
		});
		await expect(handler({ request: req })).rejects.toMatchObject({ status: 401 });
	});

	it('rejects a missing Authorization header outright', async () => {
		const handler = publishRoute(() => ({ type: 'noop' }) as never);
		const req = new Request('http://x.local/api/command', {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}',
		});
		await expect(handler({ request: req })).rejects.toMatchObject({ status: 401 });
		expect(publishSpy).not.toHaveBeenCalled();
	});
});

describe('the body cap is a DoS bound, and it is enforced', () => {
	it('rejects a payload over 4 KB', async () => {
		const big = JSON.stringify({ pad: 'x'.repeat(5000) });
		const handler = publishRoute(() => ({ type: 'noop' }) as never);
		const req = new Request('http://x.local/api/command', {
			method: 'POST', headers: auth(), body: big,
		});
		await expect(handler({ request: req })).rejects.toMatchObject({ status: 413 });
		expect(publishSpy).not.toHaveBeenCalled();
	});

	it('accepts a payload just under the cap', async () => {
		const ok = JSON.stringify({ pad: 'x'.repeat(3000) });
		const handler = publishRoute(() => ({ type: 'noop' }) as never);
		const req = new Request('http://x.local/api/command', {
			method: 'POST', headers: auth(), body: ok,
		});
		expect((await handler({ request: req })).status).toBe(200);
	});
});

describe('what it publishes and what it answers', () => {
	it('publishes exactly what toEvent returned, once', async () => {
		const event = { type: 'set_mode', mode: 'video' } as never;
		const handler = publishRoute(() => event);
		const req = new Request('http://x.local/api/command', {
			method: 'POST', headers: auth(), body: '{"mode":"video"}',
		});
		await handler({ request: req });
		expect(publishSpy).toHaveBeenCalledTimes(1);
		expect(publishSpy).toHaveBeenCalledWith(event);
	});

	it('hands toEvent the parsed body', async () => {
		const seen: unknown[] = [];
		const handler = publishRoute((b) => { seen.push(b); return { type: 'noop' } as never; });
		const req = new Request('http://x.local/api/command', {
			method: 'POST', headers: auth(), body: '{"path":"world.x","value":3}',
		});
		await handler({ request: req });
		expect(seen).toEqual([{ path: 'world.x', value: 3 }]);
	});

	it('answers {ok:true} and reflects a LAN origin back', async () => {
		// The forgotten-CORS-header case from the module header: without this
		// the admin dashboard silently stops being able to read the response.
		const handler = publishRoute(() => ({ type: 'noop' }) as never);
		const req = new Request('http://x.local/api/command', {
			method: 'POST',
			headers: { ...auth(), origin: 'http://admin-laptop.local:5173' },
			body: '{"a":1}',
		});
		const res = await handler({ request: req });
		expect(await res.json()).toEqual({ ok: true });
		expect(res.headers.get('access-control-allow-origin')).toBe('http://admin-laptop.local:5173');
	});

	it('reflects nothing for a numeric LAN origin, which is the documented policy', () => {
		// http/cors.ts calls this out explicitly: an operator who reaches
		// /admin by IP rather than by hostname gets no reflection, and that is
		// a CONSCIOUS narrowing, not a gap. Pinned so a future "fix" to the
		// regex has to be a deliberate decision rather than a passing patch.
		const handler = publishRoute(() => ({ type: 'noop' }) as never);
		const req = new Request('http://x.local/api/command', {
			method: 'POST',
			headers: { ...auth(), origin: 'http://192.168.1.50:5173' },
			body: '{"a":1}',
		});
		return handler({ request: req }).then((res) => {
			expect(res.headers.get('access-control-allow-origin')).toBeNull();
		});
	});

	it('lets toEvent reject a bad payload without publishing', async () => {
		const { error } = await import('@sveltejs/kit');
		const handler = publishRoute(() => { error(400, 'bad path'); });
		const req = new Request('http://x.local/api/command', {
			method: 'POST', headers: auth(), body: '{"path":"__proto__"}',
		});
		await expect(handler({ request: req })).rejects.toMatchObject({ status: 400 });
		expect(publishSpy).not.toHaveBeenCalled();
	});
});
