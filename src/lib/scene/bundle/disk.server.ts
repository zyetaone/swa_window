/**
 * Bundle disk persistence — server-only.
 *
 * Stores each installed bundle as a single JSON file named <id>.json in
 * the configured bundle directory. On first access, the directory is read
 * and an in-memory cache is hydrated. Subsequent reads are served from cache;
 * writes update both cache and disk.
 *
 * Storage contract:
 *   /var/aero/bundles/                (Pi deployment — via AERO_BUNDLES_DIR)
 *   ./data/bundles/                   (dev default)
 *
 * Corrupt/malformed JSON files in the directory are skipped with a warning
 * so one bad file can't crash hydration.
 *
 * This file ends in `.server.ts` so SvelteKit's Vite config refuses to bundle
 * it into the client — node:fs only works server-side.
 */

import { readdir, readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentBundle } from './types';
import { isContentBundle } from './loader';

/** Read lazily so tests can redirect via AERO_BUNDLES_DIR between cases. */
function bundlesDir(): string {
	return process.env.AERO_BUNDLES_DIR ?? './data/bundles';
}

/** In-memory mirror of the disk directory. Null until first hydration. */
let cache: Map<string, ContentBundle> | null = null;

async function ensureDir(): Promise<void> {
	if (!existsSync(bundlesDir())) {
		await mkdir(bundlesDir(), { recursive: true });
	}
}

async function hydrate(): Promise<Map<string, ContentBundle>> {
	await ensureDir();
	const map = new Map<string, ContentBundle>();
	let files: string[];
	try {
		files = await readdir(bundlesDir());
	} catch {
		return map;
	}
	for (const filename of files) {
		if (!filename.endsWith('.json')) continue;
		try {
			const raw = await readFile(join(bundlesDir(), filename), 'utf-8');
			const parsed = JSON.parse(raw);
			if (isContentBundle(parsed)) {
				map.set(parsed.id, parsed);
			} else {
				console.warn(`[bundles] skipping malformed file: ${filename}`);
			}
		} catch (e) {
			console.warn(`[bundles] failed to load ${filename}:`, e instanceof Error ? e.message : e);
		}
	}
	return map;
}

async function ensureCache(): Promise<Map<string, ContentBundle>> {
	if (!cache) cache = await hydrate();
	return cache;
}

/** All installed bundles, in insertion order. */
export async function listBundles(): Promise<ContentBundle[]> {
	const map = await ensureCache();
	return Array.from(map.values());
}

/** Install or replace a bundle. Writes to disk and updates cache. */
export async function saveBundle(bundle: ContentBundle): Promise<void> {
	const map = await ensureCache();
	await ensureDir();
	map.set(bundle.id, bundle);
	const path = join(bundlesDir(), `${bundle.id}.json`);
	await writeFile(path, JSON.stringify(bundle, null, 2), 'utf-8');
}

/** Remove a bundle. Returns true if it was present before removal. */
export async function deleteBundle(id: string): Promise<boolean> {
	const map = await ensureCache();
	if (!map.has(id)) return false;
	map.delete(id);
	try {
		await unlink(join(bundlesDir(), `${id}.json`));
	} catch (e) {
		console.warn(`[bundles] unlink failed for ${id}:`, e instanceof Error ? e.message : e);
	}
	return true;
}

/** Testing hook — clears the in-memory cache so next access re-hydrates from disk. */
export function _resetCacheForTests(): void {
	cache = null;
}
