/**
 * /api/tiles/[...path] — TILE_DIR resolution.
 *
 * The dev fallback and relative TILE_DIR values must anchor on process.cwd()
 * (repo root in dev, deploy dir on the Pi). Anchoring on import.meta.url
 * depth-counting breaks after bundling, because the emitted chunk lives deeper
 * than the source route file.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
// Root-absolute specifier: the `[...path]` rest-param segment defeats both
// Vite's relative import resolution and tsc's module resolution (glob-ish
// brackets), but `/src/...` resolves fine under vitest.
// @ts-expect-error — Vite-only specifier; typed via the cast below.
const { resolveTileDir } = (await import('/src/routes/api/tiles/[...path]/+server.ts')) as {
	resolveTileDir: (
		env?: NodeJS.ProcessEnv,
		cwd?: string,
		piDirExists?: (path: string) => boolean,
	) => string;
};

const CWD = '/srv/aero';

describe('resolveTileDir', () => {
	it('returns an absolute TILE_DIR unchanged (fast path)', () => {
		expect(resolveTileDir({ TILE_DIR: '/opt/custom/tiles' }, CWD, () => false)).toBe(
			'/opt/custom/tiles',
		);
	});

	it('resolves a relative TILE_DIR against cwd', () => {
		expect(resolveTileDir({ TILE_DIR: 'tiles' }, CWD, () => false)).toBe(resolve(CWD, 'tiles'));
	});

	it('prefers the Pi path when it exists and TILE_DIR is unset', () => {
		expect(resolveTileDir({}, CWD, () => true)).toBe('/opt/zyeta-aero/tiles');
	});

	it('falls back to ./data/tiles under cwd', () => {
		expect(resolveTileDir({}, CWD, () => false)).toBe(resolve(CWD, 'data/tiles'));
	});
});
