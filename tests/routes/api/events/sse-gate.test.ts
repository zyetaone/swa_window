/**
 * GET /api/events — loopback-only SSE gate.
 *
 * The stream replays buffered config_patch / command events (fleet control
 * traffic) and every subscriber pins an open connection, so only the Pi's
 * own browser may attach. Same isLoopback(getClientAddress()) gate as
 * /api/status POST: remote LAN clients get 403.
 */

import { describe, it, expect } from 'vitest';
import { GET } from '../../../../src/routes/api/events/+server';

function call(clientAddress: string) {
	const request = new Request('http://localhost/api/events');
	return GET({
		request,
		url: new URL(request.url),
		getClientAddress: () => clientAddress,
	} as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/events', () => {
	it('rejects non-loopback callers with 403', () => {
		for (const addr of ['192.168.1.42', '10.0.0.5']) {
			let status = 0;
			try { call(addr); } catch (e) { status = (e as { status: number }).status; }
			expect(status).toBe(403);
		}
	});

	it('opens an SSE stream for loopback callers', async () => {
		const res = call('127.0.0.1') as Response;
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		// Cancel immediately so the keep-alive interval is torn down.
		await res.body?.cancel();
	});

	it('accepts the IPv6 loopback spellings too', async () => {
		for (const addr of ['::1', '::ffff:127.0.0.1']) {
			const res = call(addr) as Response;
			expect(res.status).toBe(200);
			await res.body?.cancel();
		}
	});
});
