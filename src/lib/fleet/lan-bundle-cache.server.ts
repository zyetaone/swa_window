/**
 * Bundle cache + 4-tier fetch ladder.
 *
 * Fetch priority (first hit wins):
 *   1. Local disk (already cached by this Pi)
 *   2. LAN peer (another Pi on the same subnet, discovered by lan-peers)
 *   3. Cloudflare push Worker (remote origin, https-gated)
 *   4. Original CDN (scene-effect-specific, e.g. a video URL)
 *
 * Bundle blobs are content-addressed (sha256-hex) and sharded by first 2
 * hex chars so no directory balloons. Hash is validated as 16-128 hex
 * chars before any filesystem op to close directory-traversal surface.
 *
 * Extracted from `lan-proxy.server.ts` — peer discovery + mDNS now lives
 * in `lan-peers.server.ts`. This module imports only `listPeers` from there.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

import { listPeers, type Peer } from './lan-peers.server';

// ─── Configuration ──────────────────────────────────────────────────────────

/** Where cached bundle blobs live on disk. */
function cacheDir(): string {
	return process.env.AERO_LAN_CACHE_DIR ?? './data/lan-cache';
}

/**
 * Compute the content-addressed hash path for a bundle blob.
 * Hash is the caller's responsibility — we assume the bundle system already
 * content-addresses everything. Validates hex shape so nothing malicious
 * slips into cache paths (directory traversal).
 */
function pathFor(hash: string): string {
	if (!/^[a-f0-9]{16,128}$/i.test(hash)) {
		throw new Error(`invalid bundle hash: ${hash}`);
	}
	return join(cacheDir(), hash.slice(0, 2), `${hash}.bin`);
}

// ─── Local disk cache ───────────────────────────────────────────────────────

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

/**
 * Write a newly-fetched blob to disk so we become a future source for peers.
 * No-ops on failure — disk pressure shouldn't block the app.
 */
export async function writeLocal(hash: string, data: Uint8Array): Promise<void> {
	let path: string;
	try { path = pathFor(hash); } catch { return; }
	try {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, data);
	} catch (e) {
		console.warn(`[lan-bundle-cache] writeLocal failed for ${hash}:`, (e as Error).message);
	}
}

/**
 * Compute a sha256 hex hash of a blob. Caller-facing — used for integrity
 * checks when we pull from a peer or remote origin.
 */
export function sha256Hex(data: Uint8Array): string {
	return createHash('sha256').update(data).digest('hex');
}

// ─── Peer + remote fetch (internal) ─────────────────────────────────────────

async function fetchFromPeer(peer: Peer, hash: string): Promise<Uint8Array | null> {
	try {
		// 2s timeout — LAN should answer instantly; anything slower is probably
		// a peer leaving the network and we should fall through to remote.
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), 2_000);
		const res = await fetch(`http://${peer.host}:${peer.port}/api/bundle/${hash}`, {
			signal: ctrl.signal,
		});
		clearTimeout(t);
		if (!res.ok) return null;
		return new Uint8Array(await res.arrayBuffer());
	} catch {
		return null;
	}
}

async function fetchFromOrigin(url: string): Promise<Uint8Array | null> {
	try {
		const res = await fetch(url);
		if (!res.ok) return null;
		return new Uint8Array(await res.arrayBuffer());
	} catch {
		return null;
	}
}

// ─── 4-tier fetch ladder ────────────────────────────────────────────────────

/**
 * Returns the blob + which source served it. `expectedHash` is implicit —
 * the hash param IS the expected hash, and LAN peer responses are verified
 * against it before cache. Blob is persisted locally on non-local hits so
 * the next call is O(1).
 */
export async function fetchBundle(
	hash: string,
	remoteUrl: string,
	pushWorkerUrl?: string,
): Promise<{ data: Uint8Array; source: 'local' | 'lan' | 'push' | 'origin' } | null> {
	// 1. local disk
	const local = await readLocal(hash);
	if (local) return { data: local, source: 'local' };

	// 2. LAN peers (serial; first hit wins)
	const peerList = listPeers();
	if (peerList.length > 0) {
		for (const p of peerList) {
			const blob = await fetchFromPeer(p, hash);
			if (blob) {
				if (sha256Hex(blob) === hash.toLowerCase()) {
					await writeLocal(hash, blob);
					return { data: blob, source: 'lan' };
				}
				// Integrity failure → try next peer, don't cache.
				console.warn(`[lan-bundle-cache] peer ${p.deviceId} returned mismatched hash`);
			}
		}
	}

	// 3. Cloudflare push Worker — only if configured and https:.
	// Validating here closes a future SSRF surface: even if `pushWorkerUrl`
	// were ever repopulated from a fleet message (currently build-time env),
	// http:// or a malformed value would never reach `fetchFromOrigin`.
	if (pushWorkerUrl) {
		let safePushUrl: string | null = null;
		try {
			const u = new URL(pushWorkerUrl);
			if (u.protocol === 'https:') safePushUrl = `${u.origin}${u.pathname.replace(/\/$/, '')}/blob/${hash}`;
			else console.warn(`[lan-bundle-cache] ignoring non-https pushWorkerUrl: ${u.protocol}`);
		} catch (e) {
			console.warn(`[lan-bundle-cache] invalid pushWorkerUrl: ${(e as Error).message}`);
		}
		if (safePushUrl) {
			const pushBlob = await fetchFromOrigin(safePushUrl);
			if (pushBlob) {
				await writeLocal(hash, pushBlob);
				return { data: pushBlob, source: 'push' };
			}
		}
	}

	// 4. Original CDN
	const originBlob = await fetchFromOrigin(remoteUrl);
	if (originBlob) {
		await writeLocal(hash, originBlob);
		return { data: originBlob, source: 'origin' };
	}

	return null;
}
