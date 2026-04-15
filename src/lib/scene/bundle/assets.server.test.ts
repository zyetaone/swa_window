// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as assets from './assets.server';

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
