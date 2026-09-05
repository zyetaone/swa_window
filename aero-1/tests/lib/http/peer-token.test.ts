/**
 * Browser-side peer-token cache. Pins the three behaviours that
 * downstream fleet code relies on:
 *   1. concurrent callers share one in-flight fetch
 *   2. once resolved, subsequent calls do not re-fetch
 *   3. on deliberate failure (403/503) callers see no Authorization header
 *      so the fetch still goes out — the receiving peer just rejects with
 *      401, which is the correct "peer-sync disabled" behaviour; a
 *      TRANSIENT failure (fetch throws) is not cached and the next call
 *      retries.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	getPeerToken,
	peerAuthHeader,
	__resetPeerTokenCacheForTests,
} from '$lib/http/peer-token';

const TOKEN = 'kiosk-bearer-abc';

function okResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

function errResponse(status: number): Response {
	return new Response(JSON.stringify({ error: 'no' }), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
	__resetPeerTokenCacheForTests();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('getPeerToken', () => {
	it('caches the token across calls (one fetch, even with many callers)', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okResponse({ token: TOKEN }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const first = await getPeerToken();
		const second = await getPeerToken();
		const third = await getPeerToken();

		expect(first).toBe(TOKEN);
		expect(second).toBe(TOKEN);
		expect(third).toBe(TOKEN);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('shares one in-flight promise across concurrent callers', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okResponse({ token: TOKEN }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		// Three callers fire before the first fetch resolves.
		const [a, b, c] = await Promise.all([getPeerToken(), getPeerToken(), getPeerToken()]);

		expect(a).toBe(TOKEN);
		expect(b).toBe(TOKEN);
		expect(c).toBe(TOKEN);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('caches null on 403 (cross-origin or non-localhost caller)', async () => {
		const fetchMock = vi.fn().mockResolvedValue(errResponse(403));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		expect(await getPeerToken()).toBeNull();
		expect(await getPeerToken()).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('caches null on 503 (AERO_ADMIN_TOKEN unset on the Pi)', async () => {
		const fetchMock = vi.fn().mockResolvedValue(errResponse(503));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		expect(await getPeerToken()).toBeNull();
		expect(await getPeerToken()).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does NOT cache null when fetch throws (network failure retries)', async () => {
		// A transient failure (e.g. fetch races an OTA app restart) must not
		// disable peer auth for the life of the tab — the next call retries.
		const fetchMock = vi.fn()
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValue(okResponse({ token: TOKEN }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		expect(await getPeerToken()).toBeNull();
		expect(await getPeerToken()).toBe(TOKEN);
		expect(await getPeerToken()).toBe(TOKEN);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('peerAuthHeader', () => {
	it('returns an empty header object when the token is unavailable', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(errResponse(503)) as unknown as typeof fetch;
		const header = await peerAuthHeader();
		expect(header).toEqual({});
	});

	it('returns a Bearer header on success', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(okResponse({ token: TOKEN })) as unknown as typeof fetch;
		const header = await peerAuthHeader();
		expect(header).toEqual({ Authorization: `Bearer ${TOKEN}` });
	});

	it('treats a non-string token in the response as no token', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(okResponse({ token: 42 })) as unknown as typeof fetch;
		const header = await peerAuthHeader();
		expect(header).toEqual({});
	});

	it('treats an empty-string token as no token', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(okResponse({ token: '' })) as unknown as typeof fetch;
		const header = await peerAuthHeader();
		expect(header).toEqual({});
	});
});
