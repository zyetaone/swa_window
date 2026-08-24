// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as assets from '$lib/server/bundle/assets';

let tmp: string;

beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), 'aero-assets-'));
	process.env.AERO_ASSETS_DIR = tmp;
});

afterEach(async () => {
	delete process.env.AERO_ASSETS_DIR;
	await rm(tmp, { recursive: true, force: true });
});

describe('isAllowedExtension', () => {
	it('accepts known media extensions', () => {
		for (const name of ['x.mp4', 'x.webm', 'x.png', 'x.jpg', 'x.jpeg', 'x.webp']) {
			expect(assets.isAllowedExtension(name)).toBe(true);
		}
	});
	it('rejects unknown extensions', () => {
		for (const name of ['x.exe', 'x.sh', 'x', 'x.json', 'x.html']) {
			expect(assets.isAllowedExtension(name)).toBe(false);
		}
	});
	it('is case-insensitive', () => {
		expect(assets.isAllowedExtension('FOO.MP4')).toBe(true);
	});
});

describe('mimeFor', () => {
	it('returns correct mime for known extensions', () => {
		expect(assets.mimeFor('x.mp4')).toBe('video/mp4');
		expect(assets.mimeFor('x.webm')).toBe('video/webm');
		expect(assets.mimeFor('x.png')).toBe('image/png');
		expect(assets.mimeFor('x.jpg')).toBe('image/jpeg');
		expect(assets.mimeFor('x.jpeg')).toBe('image/jpeg');
		expect(assets.mimeFor('x.webp')).toBe('image/webp');
	});
	it('falls back to octet-stream', () => {
		expect(assets.mimeFor('x.bin')).toBe('application/octet-stream');
	});
});

describe('saveAsset / listAssets / readAsset', () => {
	it('stores and retrieves bytes by content-addressed filename', async () => {
		const bytes = new TextEncoder().encode('hello world');
		const info = await assets.saveAsset('greeting.png', bytes);

		expect(info.filename).toMatch(/^[a-f0-9]{16}\.png$/);
		expect(info.size).toBe(bytes.byteLength);
		expect(info.url).toBe(`/api/assets/${info.filename}`);

		const back = await assets.readAsset(info.filename);
		expect(back).not.toBeNull();
		expect(new TextDecoder().decode(back!)).toBe('hello world');
	});

	it('produces identical filename for identical bytes (dedupe)', async () => {
		const bytes = new TextEncoder().encode('same content');
		const a = await assets.saveAsset('a.png', bytes);
		const b = await assets.saveAsset('different.png', bytes);
		expect(a.filename).toBe(b.filename);
	});

	it('lists every stored file', async () => {
		await assets.saveAsset('x.png', new TextEncoder().encode('alpha'));
		await assets.saveAsset('y.png', new TextEncoder().encode('beta'));
		const list = await assets.listAssets();
		expect(list).toHaveLength(2);
		for (const a of list) {
			expect(a.filename).toMatch(/^[a-f0-9]{16}\.png$/);
			expect(a.size).toBeGreaterThan(0);
		}
	});

	it('returns null for an unknown filename', async () => {
		expect(await assets.readAsset('00000000ffffffff.mp4')).toBeNull();
	});
});

describe('openAsset — streamed serving', () => {
	/**
	 * The route serves media with this, not readAsset. Uploads are capped at
	 * 50 MB and the device serving them is also running the render loop, so
	 * "the bytes arrive correctly" is only half the contract — the other half
	 * is that they are never all in memory at once. These pin the half a test
	 * can actually observe: identity of the bytes, and an accurate size.
	 */
	it('streams back exactly the bytes that were saved', async () => {
		const body = new Uint8Array(Array.from({ length: 5000 }, (_, i) => i % 256));
		const saved = await assets.saveAsset('clip.mp4', body);

		const opened = await assets.openAsset(saved.filename);
		expect(opened).not.toBeNull();

		const chunks: Uint8Array[] = [];
		const reader = opened!.stream.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
		}
		const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
		let at = 0;
		for (const c of chunks) { joined.set(c, at); at += c.length; }
		expect(joined).toEqual(body);
	});

	it('reports the size without the caller reading the stream', async () => {
		// Content-Length comes from here. If it disagreed with the body the
		// browser would truncate or hang the video rather than error visibly.
		const body = new Uint8Array(1234);
		const saved = await assets.saveAsset('clip.mp4', body);
		const opened = await assets.openAsset(saved.filename);
		expect(opened!.size).toBe(1234);
		await opened!.stream.cancel();
	});

	it('arrives in more than one chunk for a large asset', async () => {
		// The point of the change: a 50 MB upload must not materialise as one
		// buffer. A single-chunk stream would satisfy every other assertion
		// here while doing exactly what this replaced.
		const body = new Uint8Array(300_000);
		const saved = await assets.saveAsset('big.mp4', body);
		const opened = await assets.openAsset(saved.filename);
		let chunks = 0;
		const reader = opened!.stream.getReader();
		for (;;) {
			const { done } = await reader.read();
			if (done) break;
			chunks++;
		}
		expect(chunks).toBeGreaterThan(1);
	});

	it('returns null for an absent asset rather than throwing', async () => {
		expect(await assets.openAsset('deadbeefdeadbeef.mp4')).toBeNull();
	});
});
