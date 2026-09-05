/**
 * safeResolveWithin — shared path-traversal / symlink-escape guard for
 * file-serving routes (/api/tiles, /api/bundle/:hash).
 *
 * Two hand-rolled copies of this lived in the tiles and bundle routes; the
 * bundle copy's own comment admitted it mirrored the tiles one. Both serve
 * files from directories that untrusted-ish input influences (URL path
 * segments, peer-synced cache writes), so the checks must not drift apart:
 *
 *   1. resolve subPath against root and verify the string prefix — blocks
 *      `..` traversal in the URL/path itself.
 *   2. existsSync — missing file is a 404, distinct from an escape attempt.
 *   3. realpath BOTH sides and compare — a symlink planted inside the root
 *      (e.g. by peer cache sync) must not resolve outside it. Comparing real
 *      paths on both sides also keeps the guard correct when root itself
 *      traverses a symlink (macOS /var → /private/var).
 *
 * Result is a flat discriminated record — `forbidden` means escape attempt
 * (403-worthy), `notFound` means absent/unresolvable (404-worthy). Callers
 * that collapse both to the same response (bundle) may ignore the split.
 */

import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SafeResolveResult {
	filePath: string;
	notFound: boolean;
	forbidden: boolean;
}

export function safeResolveWithin(root: string, subPath: string): SafeResolveResult {
	const rootDir = root.replace(/\/+$/, '') + '/';
	const filePath = resolve(rootDir, subPath);
	if (!filePath.startsWith(rootDir)) return { filePath, notFound: false, forbidden: true };
	if (!existsSync(filePath)) return { filePath, notFound: true, forbidden: false };
	try {
		const realRoot = realpathSync(rootDir);
		const real = realpathSync(filePath);
		if (real !== realRoot && !real.startsWith(realRoot + '/')) {
			return { filePath, notFound: false, forbidden: true };
		}
	} catch {
		// Unresolvable realpath (broken symlink, dangling root) — treat as absent.
		return { filePath, notFound: true, forbidden: false };
	}
	return { filePath, notFound: false, forbidden: false };
}
