/**
 * Body size-limit readers. These guard every JSON-accepting and
 * blob-accepting API route from chunked-transfer-encoding DoS — the cap is
 * enforced on bytes received, not Content-Length. Tests pin that exact
 * behavior so a regression can't accidentally start trusting the header.
 */

import { describe, it, expect } from 'vitest';
import { readLimitedJson, readLimitedBlob } from '$lib/http/body';

function requestWithBody(body: string | Uint8Array): Request {
	const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
	// Wrap in a ReadableStream — TypeScript's BodyInit doesn't accept bare
	// Uint8Array under the lib.dom types, even though runtimes do.
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
	return new Request('http://x.local/api', {
		method: 'POST',
		body: stream,
		headers: { 'content-type': 'application/octet-stream' },
		// Required when body is a stream per the fetch spec.
		// @ts-expect-error duplex is valid in undici/Node but missing from lib.dom
		duplex: 'half',
	});
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

describe('readLimitedJson', () => {
	it('parses valid JSON within the limit', async () => {
		const req = requestWithBody('{"hello":"world","n":42}');
		const out = await readLimitedJson<{ hello: string; n: number }>(req, 1024);
		expect(out).toEqual({ hello: 'world', n: 42 });
	});

	it('rejects bodies that exceed the cap with 413', async () => {
		const big = '{"x":"' + 'A'.repeat(5000) + '"}';
		const req = requestWithBody(big);
		await expect(readLimitedJson(req, 1024)).rejects.toMatchObject({ status: 413 });
	});

	it('accepts a body exactly at the limit', async () => {
		// 7-byte payload "{\"a\":1}"
		const payload = '{"a":1}';
		const req = requestWithBody(payload);
		const out = await readLimitedJson<{ a: number }>(req, payload.length);
		expect(out).toEqual({ a: 1 });
	});

	it('rejects malformed JSON with 400', async () => {
		const req = requestWithBody('{ not json }');
		await expect(readLimitedJson(req, 1024)).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a missing body with 400', async () => {
		const req = new Request('http://x.local/api', { method: 'POST' });
		await expect(readLimitedJson(req, 1024)).rejects.toMatchObject({ status: 400 });
	});
});

describe('readLimitedBlob', () => {
	it('returns the full bytes when within the limit', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4, 5]);
		const out = await readLimitedBlob(streamFromBytes(bytes), 100);
		expect(out).toEqual(bytes);
	});

	it('rejects oversized streams with 413', async () => {
		const bytes = new Uint8Array(2048);
		await expect(readLimitedBlob(streamFromBytes(bytes), 1024)).rejects.toMatchObject({ status: 413 });
	});

	it('rejects mid-stream even when the producer would have kept writing', async () => {
		// Emit multiple chunks; the second one alone is larger than the cap,
		// so the cap should trip on the second read() — not after fully buffering.
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(500));
				controller.enqueue(new Uint8Array(2000));
				controller.close();
			},
		});
		await expect(readLimitedBlob(stream, 1024)).rejects.toMatchObject({ status: 413 });
	});
});
