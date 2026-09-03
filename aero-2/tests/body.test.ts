import { describe, it, expect } from 'vitest';
import { readLimited, readLimitedJson } from '#lib/server/body.js';

const stream = (chunks: string[]): ReadableStream<Uint8Array> =>
	new ReadableStream({
		start(controller) {
			for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
			controller.close();
		}
	});

const post = (body: string) => new Request('http://pane/api/x', { method: 'POST', body });

describe('readLimited', () => {
	it('returns the bytes when under the cap', async () => {
		const res = await readLimited(stream(['ab', 'cd']), 100);
		expect(res.ok).toBe(true);
		expect(res.ok && new TextDecoder().decode(res.value)).toBe('abcd');
	});

	it('reassembles multi-chunk bodies in order', async () => {
		const res = await readLimited(stream(['one', 'two', 'three']), 100);
		expect(res.ok && new TextDecoder().decode(res.value)).toBe('onetwothree');
	});

	/**
	 * The cap is enforced on bytes RECEIVED, not on Content-Length — a chunked
	 * sender never sets that header, and a lying one sets it low. This is the
	 * case that separates the two.
	 */
	it('rejects mid-stream at 413 without buffering the whole payload', async () => {
		const res = await readLimited(stream(['x'.repeat(10), 'x'.repeat(10)]), 15);
		expect(res.ok).toBe(false);
		expect(!res.ok && res.response.status).toBe(413);
	});

	it('treats a missing body as 400, not as empty', async () => {
		const res = await readLimited(null, 100);
		expect(!res.ok && res.response.status).toBe(400);
	});
});

describe('readLimitedJson', () => {
	it('parses JSON under the cap', async () => {
		const res = await readLimitedJson<{ a: number }>(post('{"a":1}'), 100);
		expect(res.ok && res.value.a).toBe(1);
	});

	it('returns 400 for malformed JSON', async () => {
		const res = await readLimitedJson(post('{nope'), 100);
		expect(!res.ok && res.response.status).toBe(400);
	});

	it('returns 413 before parsing when over the cap', async () => {
		const res = await readLimitedJson(post(JSON.stringify({ a: 'x'.repeat(200) })), 20);
		expect(!res.ok && res.response.status).toBe(413);
	});
});
