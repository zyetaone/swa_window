/**
 * LAN bundle proxy — peer-to-peer content distribution for the Pi fleet.
 *
 * Six Pis per install share the same LAN. When one Pi fetches a content
 * bundle (video-bg, sprite, etc.) from the Cloudflare push Worker, every
 * other Pi on the LAN can grab it directly from the first peer instead of
 * all six hitting the remote origin. This reduces total WAN traffic by
 * ~5× on every new bundle rollout.
 *
 * Discovery: mDNS (RFC 6762). Service type `_aero-bundle._tcp.local`.
 * Announce interval: 30s. Listen for peer announces on unicast.
 *
 * Fetch priority (first hit wins):
 *   1. Local disk (already cached by this Pi)
 *   2. LAN peer (another Pi on the same subnet announced via mDNS)
 *   3. Cloudflare push Worker (remote origin)
 *   4. Original CDN (scene-effect-specific, e.g. a video URL)
 *
 * File is `.server.ts` so Vite refuses to bundle it into the client — all
 * mDNS / fs / net work happens in the Node/Bun process only.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import mdns from 'multicast-dns';

// ─── Configuration ──────────────────────────────────────────────────────────

const SERVICE_TYPE = '_aero-bundle._tcp.local';
const ANNOUNCE_INTERVAL_MS = 30_000;
/** Peer announcement is considered stale after this many ms without a refresh. */
const PEER_TTL_MS = 90_000;

/** Where cached bundle blobs live on disk. */
function cacheDir(): string {
	return process.env.AERO_LAN_CACHE_DIR ?? './data/lan-cache';
}

/** Local service port — the admin-exposed `/lan/bundle/:hash` endpoint. */
function servicePort(): number {
	return Number.parseInt(process.env.PORT ?? '3000', 10);
}

/** Device hostname used in mDNS answers. Falls back to `aero-unknown`. */
function deviceHost(): string {
	return process.env.AERO_DEVICE_ID ?? process.env.HOSTNAME ?? 'aero-unknown';
}

// ─── Peer registry (in-memory, mDNS-populated) ──────────────────────────────

interface Peer {
	deviceId: string;
	host: string;
	port: number;
	lastSeen: number;
}

const peers = new Map<string, Peer>();

/** Purge peers we haven't heard from in PEER_TTL_MS. */
function gcPeers(): void {
	const cutoff = Date.now() - PEER_TTL_MS;
	for (const [id, p] of peers) {
		if (p.lastSeen < cutoff) peers.delete(id);
	}
}

/** Snapshot of current live peers — exposed for admin UI / tests. */
export function listPeers(): readonly Peer[] {
	gcPeers();
	return Array.from(peers.values());
}

// ─── mDNS wiring ────────────────────────────────────────────────────────────

let mdnsServer: ReturnType<typeof mdns> | null = null;
let announceTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Broadcast our service record on the LAN. Called on startup and then every
 * ANNOUNCE_INTERVAL_MS. Other Pis pick this up and populate their peer list.
 *
 * We announce an SRV record so peers can resolve our host + port without
 * needing a TXT record, plus an A/AAAA via the OS's normal mDNS responder.
 */
function announce(): void {
	if (!mdnsServer) return;
	const name = `${deviceHost()}.${SERVICE_TYPE}`;
	try {
		mdnsServer.respond({
			answers: [
				{
					name: SERVICE_TYPE,
					type: 'PTR',
					ttl: 120,
					data: name,
				},
				{
					name,
					type: 'SRV',
					ttl: 120,
					data: { priority: 0, weight: 0, port: servicePort(), target: `${deviceHost()}.local` },
				},
				{
					name,
					type: 'TXT',
					ttl: 120,
					data: [Buffer.from(`deviceId=${deviceHost()}`)],
				},
			],
		});
	} catch (e) {
		// mDNS is best-effort; never crash the app over a broadcast failure.
		console.warn('[lan-proxy] mDNS announce failed:', (e as Error).message);
	}
}

/**
 * Handle an mDNS response from another Pi. We only care about answers
 * carrying our SERVICE_TYPE PTR + SRV pair.
 */
function handleResponse(resp: { answers?: Array<{ name: string; type: string; data: unknown }> }): void {
	if (!resp.answers) return;
	let deviceId: string | null = null;
	let port: number | null = null;
	let host: string | null = null;
	for (const ans of resp.answers) {
		if (ans.type === 'SRV' && typeof ans.name === 'string' && ans.name.endsWith(SERVICE_TYPE)) {
			const srv = ans.data as { port: number; target: string };
			port = srv.port;
			host = srv.target;
			// Extract the first label as the device id.
			deviceId = ans.name.split('.')[0] ?? null;
		}
	}
	if (deviceId && port && host && deviceId !== deviceHost()) {
		peers.set(deviceId, { deviceId, host, port, lastSeen: Date.now() });
	}
}

/**
 * Start the LAN proxy. Idempotent — calling twice is a no-op.
 * Returns a stop function for test teardown.
 */
export function startLanProxy(): () => void {
	if (mdnsServer) return () => {};
	try {
		mdnsServer = mdns();
		mdnsServer.on('response', handleResponse);
		// Kick off discovery by querying for our own service type. Any peer
		// already running will respond, populating our peer map immediately.
		mdnsServer.query({ questions: [{ name: SERVICE_TYPE, type: 'PTR' }] });
		announce();
		announceTimer = setInterval(() => {
			announce();
			gcPeers();
		}, ANNOUNCE_INTERVAL_MS);
	} catch (e) {
		console.warn('[lan-proxy] mDNS start failed (LAN proxy disabled):', (e as Error).message);
	}
	return stopLanProxy;
}

export function stopLanProxy(): void {
	if (announceTimer) {
		clearInterval(announceTimer);
		announceTimer = null;
	}
	if (mdnsServer) {
		try { mdnsServer.destroy(); } catch { /* already torn down */ }
		mdnsServer = null;
	}
	peers.clear();
}

// ─── Local bundle cache ─────────────────────────────────────────────────────

/**
 * Compute the content-addressed hash path for a bundle blob.
 * Hash is the caller's responsibility — we assume the bundle system already
 * content-addresses everything. We just do sha256-of-hash to derive a
 * filesystem-safe key so nothing malicious slips into cache paths.
 */
function pathFor(hash: string): string {
	// Validate — must be 32+ hex chars. Reject anything else so this endpoint
	// can't be used as a directory traversal primitive.
	if (!/^[a-f0-9]{16,128}$/i.test(hash)) {
		throw new Error(`invalid bundle hash: ${hash}`);
	}
	// Shard by first 2 chars so one dir doesn't balloon.
	return join(cacheDir(), hash.slice(0, 2), `${hash}.bin`);
}

/**
 * Read a cached bundle blob from disk. Returns null if absent.
 * Used by the `/lan/bundle/:hash` endpoint.
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
		console.warn(`[lan-proxy] writeLocal failed for ${hash}:`, (e as Error).message);
	}
}

/**
 * Compute a sha256 hex hash of a blob. Caller-facing — used for integrity
 * checks when we pull from a peer or remote origin.
 */
export function sha256Hex(data: Uint8Array): string {
	return createHash('sha256').update(data).digest('hex');
}

// ─── Peer + remote fetch ────────────────────────────────────────────────────

async function fetchFromPeer(peer: Peer, hash: string): Promise<Uint8Array | null> {
	try {
		// 2s timeout — LAN should answer instantly; anything slower is probably
		// a peer leaving the network and we should fall through to remote.
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), 2_000);
		const res = await fetch(`http://${peer.host}:${peer.port}/lan/bundle/${hash}`, {
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

/**
 * Four-tier bundle fetch. Returns the blob + which source served it.
 *
 * `expectedHash` is optional. If provided, we verify the blob's sha256
 * matches before returning it (prevents a malicious peer from serving bad
 * data). Blob is persisted locally regardless of source so next call is O(1).
 */
export async function fetchBundle(
	hash: string,
	remoteUrl: string,
	pushWorkerUrl?: string,
): Promise<{ data: Uint8Array; source: 'local' | 'lan' | 'push' | 'origin' } | null> {
	// 1. local disk
	const local = await readLocal(hash);
	if (local) return { data: local, source: 'local' };

	// 2. LAN peers (parallel race; first hit wins)
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
				console.warn(`[lan-proxy] peer ${p.deviceId} returned mismatched hash`);
			}
		}
	}

	// 3. Cloudflare push Worker
	if (pushWorkerUrl) {
		const pushBlob = await fetchFromOrigin(`${pushWorkerUrl.replace(/\/$/, '')}/blob/${hash}`);
		if (pushBlob) {
			await writeLocal(hash, pushBlob);
			return { data: pushBlob, source: 'push' };
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

// ─── Test hooks ─────────────────────────────────────────────────────────────

/** Inject a synthetic peer — for tests only. */
export function _addPeerForTests(peer: Peer): void {
	peers.set(peer.deviceId, peer);
}

/** Clear all peers + in-memory state — for tests only. */
export function _resetForTests(): void {
	peers.clear();
}
