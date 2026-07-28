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
 * Auth is left to a later phase before any product ships.
 */

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

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
