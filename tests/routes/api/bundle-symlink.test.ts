/**
 * /api/bundle/[hash] — symlink-escape guard (review item I2).
 *
 * The hash pattern stops traversal in the URL, but the LAN cache directory is
 * written by peer sync, so a planted symlink is the realistic escape. The route
 * must compare REAL paths, not the joined string.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Bracketed dir name: import via a computed specifier so the resolver does not
// treat [hash] as a glob-ish pattern.
const { GET } = await import('../../../src/routes/api/bundle/[hash]/+server.ts');

const HASH = 'a'.repeat(32);
let cacheDir: string;
let secretDir: string;

beforeEach(() => {
	cacheDir = mkdtempSync(join(tmpdir(), 'aero-cache-'));
	secretDir = mkdtempSync(join(tmpdir(), 'aero-secret-'));
	vi.stubEnv('AERO_LAN_CACHE_DIR', cacheDir);
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(cacheDir, { recursive: true, force: true });
	rmSync(secretDir, { recursive: true, force: true });
});

function call(hash: string) {
	const request = new Request(`http://localhost/api/bundle/${hash}`);
	return GET({ params: { hash }, request } as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/bundle/[hash]', () => {
	it('serves a genuine cached bundle', async () => {
		const shard = join(cacheDir, HASH.slice(0, 2));
		mkdirSync(shard, { recursive: true });
		writeFileSync(join(shard, `${HASH}.bin`), 'REAL-BUNDLE');

		const res = (await call(HASH)) as Response;
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('REAL-BUNDLE');
	});

	it('refuses to follow a symlink that escapes the cache directory', async () => {
		const secretFile = join(secretDir, 'passwd');
		writeFileSync(secretFile, 'ROOT-SECRET');

		const shard = join(cacheDir, HASH.slice(0, 2));
		mkdirSync(shard, { recursive: true });
		symlinkSync(secretFile, join(shard, `${HASH}.bin`));

		// 404, not a 200 leaking ROOT-SECRET.
		await expect(call(HASH)).rejects.toMatchObject({ status: 404 });
	});

	it('rejects a malformed hash before touching the filesystem', async () => {
		await expect(call('../../etc/passwd')).rejects.toMatchObject({ status: 400 });
		await expect(call('nothex')).rejects.toMatchObject({ status: 400 });
	});
});
