/**
 * Local-disk bundle cache — read side only.
 *
 * Bundle blobs are content-addressed (sha256-hex) and sharded by the
 * first 2 hex chars so no directory balloons. Hash is validated as
 * 16-128 hex chars before any filesystem op (directory-traversal guard).
 *
 * NOTE — phase-11: the prior 4-tier fetch ladder (local → LAN peer →
 * Cloudflare push → origin CDN) was extracted from `lan-proxy.server.ts`
 * but never wired to a consumer. Deleted as fantasy architecture. If we
 * need it back, restore from git history (`fetchBundle` + helpers) and
 * call from `bundle/remote.ts` when receiving a bundle reference.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Where cached bundle blobs live on disk. */
function cacheDir(): string {
	return process.env.AERO_LAN_CACHE_DIR ?? './data/lan-cache';
}

/**
 * Compute the content-addressed hash path for a bundle blob.
 * Hash shape is validated to close directory-traversal surface.
 */
function pathFor(hash: string): string {
	if (!/^[a-f0-9]{16,128}$/i.test(hash)) {
		throw new Error(`invalid bundle hash: ${hash}`);
	}
	return join(cacheDir(), hash.slice(0, 2), `${hash}.bin`);
}

/**
 * Read a cached bundle blob from disk. Returns null if absent.
 * Used by the `/api/bundle/:hash` endpoint.
 */
export async function readLocal(hash: string): Promise<Uint8Array | null> {
	let path: string;
	try { path = pathFor(hash); } catch { return null; }
	if (!existsSync(path)) return null;
	try { return new Uint8Array(await readFile(path)); } catch { return null; }
}
