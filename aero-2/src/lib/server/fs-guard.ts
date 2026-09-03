/**
 * safeResolveWithin — shared path-traversal / symlink-escape guard for every
 * route that serves a file from a directory an untrusted path segment reaches.
 *
 * Three checks, and each one catches something the others do not:
 *
 *   1. resolve against root and verify the string prefix — blocks `..` in the
 *      URL path itself.
 *   2. existsSync — an absent file is a 404, categorically different from an
 *      escape attempt, and the caller needs to tell them apart.
 *   3. realpath BOTH sides and compare — a symlink planted inside the root must
 *      not resolve outside it. Real-pathing both sides also keeps the guard
 *      correct when root itself traverses a symlink (macOS /var → /private/var),
 *      which is why the comparison is not against the raw root string.
 *
 * `forbidden` is 403-worthy, `notFound` is 404-worthy. Callers that collapse
 * both to one response may ignore the split; callers that leak the difference
 * on a private archive should not.
 */

import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SafeResolveResult {
	filePath: string;
	notFound: boolean;
	forbidden: boolean;
}


/** Resolve `subPath` to a file INSIDE `root`, rejecting traversal and symlink escapes. */
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
		return { filePath, notFound: true, forbidden: false };
	}
	return { filePath, notFound: false, forbidden: false };
}
