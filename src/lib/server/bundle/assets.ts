/**
 * Asset persistence — server-only.
 *
 * Uploaded files are content-addressed: SHA-256(file bytes) → 16-char hex →
 * stored as <hash>.<ext> in the asset directory. Same file uploaded twice =
 * same path = automatic dedupe.
 *
 * The directory is exposed read-only at /api/assets/[filename] so bundle
 * authors can reference uploaded assets via stable URLs.
 *
 * Storage:
 *   /var/aero/assets/                (Pi — via AERO_ASSETS_DIR)
 *   ./data/assets/                   (dev default)
 *
 * Mime sniffing is by extension only — we trust the uploader on a LAN device.
 * Auth: the ROUTES that call this are bearer-gated (POST /api/assets uses
 * requireAdminToken). This module is deliberately unauthenticated itself —
 * it is server-internal and must not grow its own gate, or the check ends up
 * in two places that can disagree.
 */

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

function assetsDir(): string {
	return process.env.AERO_ASSETS_DIR ?? './data/assets';
}

const ALLOWED_EXTS = new Set(['.mp4', '.webm', '.png', '.jpg', '.jpeg', '.webp']);

const MIME_BY_EXT: Record<string, string> = {
	'.mp4':  'video/mp4',
	'.webm': 'video/webm',
	'.png':  'image/png',
	'.jpg':  'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
};

export interface AssetInfo {
	filename: string;
	size: number;
	url: string;
}

async function ensureDir(): Promise<void> {
	if (!existsSync(assetsDir())) await mkdir(assetsDir(), { recursive: true });
}

/** Returns true if the extension is in the allowed set. */
export function isAllowedExtension(filename: string): boolean {
	return ALLOWED_EXTS.has(extname(filename).toLowerCase());
}

/** Map an extension to its mime type. */
export function mimeFor(filename: string): string {
	return MIME_BY_EXT[extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

/** All stored assets — used by GET /api/assets to list. */
export async function listAssets(): Promise<AssetInfo[]> {
	await ensureDir();
	let files: string[];
	try {
		files = await readdir(assetsDir());
	} catch {
		return [];
	}
	const out: AssetInfo[] = [];
	for (const filename of files) {
		try {
			const s = await stat(join(assetsDir(), filename));
			if (!s.isFile()) continue;
			out.push({
				filename,
				size: s.size,
				url: `/api/assets/${encodeURIComponent(filename)}`,
			});
		} catch {
			// skip unreadable
		}
	}
	return out;
}

/**
 * Save a file by its content. Returns the asset info (filename = <hash><ext>).
 * Idempotent: same bytes → same path → no re-write.
 */
export async function saveAsset(originalName: string, bytes: Uint8Array): Promise<AssetInfo> {
	const ext = extname(originalName).toLowerCase();
	const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
	const filename = `${hash}${ext}`;
	const path = join(assetsDir(), filename);
	await ensureDir();
	if (!existsSync(path)) {
		await writeFile(path, bytes);
	}
	return {
		filename,
		size: bytes.byteLength,
		url: `/api/assets/${encodeURIComponent(filename)}`,
	};
}

/** Read raw bytes for serving. Returns null if the file isn't present. */
export async function readAsset(filename: string): Promise<Uint8Array | null> {
	const path = join(assetsDir(), filename);
	if (!existsSync(path)) return null;
	return await readFile(path);
}

/**
 * Open an asset for streaming, with its size. Null if it isn't present.
 *
 * ─── WHY NOT readAsset() FOR SERVING ────────────────────────────────────────
 * readAsset buffers the WHOLE file. Uploads are capped at 50 MB, and the
 * device serving them is a Pi that is simultaneously running a 60 fps Cesium
 * render loop — materialising 50 MB per request (twice, once for the Buffer
 * and once for the Blob wrapper) is allocation and GC pressure landing exactly
 * where dropped frames are visible on the wall.
 *
 * readAsset stays for callers that genuinely want the bytes in hand.
 *
 * ⚠ NO Range/206 HERE, ON PURPOSE. Streaming is the half that pays: it removes
 * the buffer. Range buys SEEKING, and this fleet plays media start to finish
 * from a `Cache-Control: immutable` URL — nothing seeks, and a replay is a
 * cache hit rather than a refetch. Advertising `Accept-Ranges: bytes` without
 * honouring the header would be worse than staying silent, because a client
 * that believes it may then request a range it will not get. If a seekable
 * surface ever appears, implement the header and the 206 together.
 */
export async function openAsset(
	filename: string,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
	const path = join(assetsDir(), filename);
	if (!existsSync(path)) return null;
	const info = await stat(path);
	if (!info.isFile()) return null;
	const node = createReadStream(path);
	return {
		// Node stream -> web stream. The double cast is the node:stream/web vs
		// DOM ReadableStream split: structurally the same object, two separate
		// declarations, and only one of them is what Response accepts.
		stream: Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>,
		size: info.size,
	};
}
