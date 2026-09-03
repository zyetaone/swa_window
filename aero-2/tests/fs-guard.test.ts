import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeResolveWithin } from '#lib/server/fs-guard.js';

describe('safeResolveWithin', () => {
	let sandbox: string;

	beforeEach(() => {
		sandbox = mkdtempSync(join(tmpdir(), 'aero-test-tiles-'));
		mkdirSync(join(sandbox, 'gibs', '5', '10'), { recursive: true });
		writeFileSync(join(sandbox, 'gibs', '5', '10', '20.jpg'), 'fake-jpeg');
	});

	afterEach(() => {
		// cleanup temp dir
	});

	it('resolves an existing file inside root', () => {
		const res = safeResolveWithin(sandbox, 'gibs/5/10/20.jpg');
		expect(res.notFound).toBe(false);
		expect(res.forbidden).toBe(false);
		expect(res.filePath).toBe(join(sandbox, 'gibs/5/10/20.jpg'));
	});

	it('flags a missing file as notFound (not forbidden)', () => {
		const res = safeResolveWithin(sandbox, 'gibs/5/10/999.jpg');
		expect(res.notFound).toBe(true);
		expect(res.forbidden).toBe(false);
	});

	it('rejects directory traversal (../)', () => {
		const res = safeResolveWithin(sandbox, '../../../etc/passwd');
		expect(res.forbidden).toBe(true);
	});

	it('rejects absolute paths escaping root', () => {
		const res = safeResolveWithin(sandbox, '/etc/passwd');
		expect(res.forbidden).toBe(true);
	});
});

/**
 * The check the string-prefix test cannot make. A symlink INSIDE root whose
 * target is outside it resolves to a path that never starts with `..`, so only
 * the realpath comparison catches it — and a peer cache sync is exactly the
 * kind of thing that writes one.
 */
describe('safeResolveWithin - symlink escape', () => {
	it('rejects a symlink inside root that points outside it', () => {
		const sandbox = mkdtempSync(join(tmpdir(), 'aero-test-symlink-'));
		const outside = mkdtempSync(join(tmpdir(), 'aero-test-outside-'));
		writeFileSync(join(outside, 'secret.txt'), 'not yours');
		symlinkSync(join(outside, 'secret.txt'), join(sandbox, 'escape.txt'));

		const res = safeResolveWithin(sandbox, 'escape.txt');
		expect(res.forbidden).toBe(true);
	});

	it('allows a symlink whose target stays inside root', () => {
		const sandbox = mkdtempSync(join(tmpdir(), 'aero-test-symlink-ok-'));
		mkdirSync(join(sandbox, 'real'));
		writeFileSync(join(sandbox, 'real', 'tile.jpg'), 'fake-jpeg');
		symlinkSync(join(sandbox, 'real', 'tile.jpg'), join(sandbox, 'link.jpg'));

		const res = safeResolveWithin(sandbox, 'link.jpg');
		expect(res.forbidden).toBe(false);
		expect(res.notFound).toBe(false);
	});
});
