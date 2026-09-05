/**
 * TILE_DIR resolution — anchors on process.cwd(), not import.meta.url depth.
 */
import { describe, it, expect } from 'vitest';
import { resolveTileDir } from '$lib/server/tiles-dir';

const CWD = '/srv/aero';

describe('resolveTileDir', () => {
	it('returns an absolute TILE_DIR unchanged (fast path)', () => {
		expect(resolveTileDir({ TILE_DIR: '/opt/custom/tiles' }, CWD, () => false)).toBe(
			'/opt/custom/tiles',
		);
	});

	it('resolves a relative TILE_DIR against cwd', () => {
		expect(resolveTileDir({ TILE_DIR: 'data/tiles' }, CWD, () => false)).toBe(
			`${CWD}/data/tiles`,
		);
	});

	it('prefers Pi path when it exists and TILE_DIR is unset', () => {
		expect(resolveTileDir({}, CWD, (p) => p === '/opt/zyeta-aero/tiles')).toBe(
			'/opt/zyeta-aero/tiles',
		);
	});

	it('falls back to cwd/data/tiles when Pi path missing', () => {
		expect(resolveTileDir({}, CWD, () => false)).toBe(`${CWD}/data/tiles`);
	});
});
