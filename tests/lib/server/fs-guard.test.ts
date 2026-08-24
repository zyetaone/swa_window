// @vitest-environment node

/**
 * safeResolveWithin — the path-traversal guard for /api/tiles and /api/bundle.
 *
 * This had NO tests, which is the wrong shape for what it is. It is the single
 * shared defence for two routes that serve files from directories untrusted
 * input influences (URL path segments, peer-synced cache writes), it exists
 * because two hand-rolled copies were drifting apart, and the security codemap
 * records "H2: Tile path traversal — Fixed" against it. A silent regression
 * here reopens a finding the project already believes is closed.
 *
 * Each case below is an escape route the function is claiming to block, and
 * the symlink ones are the reason it does realpath at all — a prefix check
 * alone passes them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeResolveWithin } from '$lib/server/fs-guard';

let base: string, root: string, outside: string;

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), 'aero-fsguard-'));
	root = join(base, 'root');
	outside = join(base, 'outside');
	await mkdir(root, { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(join(root, 'ok.png'), 'inside');
	await writeFile(join(outside, 'secret.txt'), 'SECRET');
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

describe('serves what is legitimately inside the root', () => {
	it('resolves a plain file', () => {
		const r = safeResolveWithin(root, 'ok.png');
		expect(r).toMatchObject({ notFound: false, forbidden: false });
		expect(r.filePath).toBe(join(root, 'ok.png'));
	});

	it('resolves through a nested subdirectory (the tile z/y/x shape)', async () => {
		await mkdir(join(root, '7', '55'), { recursive: true });
		await writeFile(join(root, '7', '55', '91.png'), 'tile');
		expect(safeResolveWithin(root, '7/55/91.png')).toMatchObject({ forbidden: false, notFound: false });
	});

	it('tolerates a trailing slash on the root', () => {
		expect(safeResolveWithin(root + '/', 'ok.png')).toMatchObject({ forbidden: false, notFound: false });
	});
});

describe('blocks escapes', () => {
	it('rejects ../ traversal', () => {
		expect(safeResolveWithin(root, '../outside/secret.txt').forbidden).toBe(true);
	});

	it('rejects deep ../../ traversal', () => {
		expect(safeResolveWithin(root, '../../../../etc/passwd').forbidden).toBe(true);
	});

	it('rejects an absolute path that ignores the root entirely', () => {
		// resolve() lets an absolute subPath win outright, which is exactly why
		// the prefix check happens after resolve and not before.
		expect(safeResolveWithin(root, '/etc/passwd').forbidden).toBe(true);
	});

	it('rejects a sibling directory sharing the root name as a prefix', () => {
		// `root` vs `root-evil`: a naive startsWith(root) without the trailing
		// separator would accept this.
		const evil = join(base, 'root-evil');
		expect(safeResolveWithin(root, '../root-evil/x').forbidden).toBe(true);
		expect(evil.startsWith(root)).toBe(true);   // the trap being guarded
	});

	it('rejects a SYMLINK planted inside the root that points outside it', async () => {
		// THE case a prefix check cannot catch: the resolved string is inside
		// the root, so only comparing realpaths rejects it. Peer cache sync can
		// write into these directories, which is why this is not theoretical.
		await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'));
		const r = safeResolveWithin(root, 'link.txt');
		expect(r.filePath.startsWith(root)).toBe(true);   // passes a naive check
		expect(r.forbidden).toBe(true);                    // and is still refused
	});

	it('rejects a symlinked DIRECTORY escape', async () => {
		await symlink(outside, join(root, 'dir'));
		expect(safeResolveWithin(root, 'dir/secret.txt').forbidden).toBe(true);
	});
});

describe('distinguishes absent from forbidden', () => {
	it('reports a missing file as notFound, not forbidden', () => {
		// The split is the point: 404 and 403 are different answers, and
		// collapsing them would leak whether a path exists outside the root.
		expect(safeResolveWithin(root, 'nope.png')).toMatchObject({ notFound: true, forbidden: false });
	});

	it('reports a broken symlink as notFound rather than throwing', async () => {
		await symlink(join(outside, 'gone.txt'), join(root, 'broken.txt'));
		expect(() => safeResolveWithin(root, 'broken.txt')).not.toThrow();
		expect(safeResolveWithin(root, 'broken.txt').notFound).toBe(true);
	});
});
