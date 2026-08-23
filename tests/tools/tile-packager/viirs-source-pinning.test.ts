/**
 * The packaged VIIRS tiles and the runtime fallback must be the SAME raster.
 *
 * The layer name and the pinned acquisition date are written out twice — once
 * in tools/tile-packager/src/sources.ts, once in src/lib/world/viirs-field.ts —
 * because a bun packager script has no business importing a browser module
 * that builds canvases. Both sites carry a "keep in step with the other" note,
 * which is exactly the kind of instruction that survives right up until someone
 * re-pins one of them.
 *
 * Drift is silent and looks like nothing: the Pi serves cache hits from date A
 * and falls back to date B on a miss, so one city's lights change brightness
 * depending on whether its tiles happened to be packaged. This is the whole
 * guard — no shared constant, just a test that fails when they disagree.
 */
import { describe, it, expect } from 'vitest';
import { SOURCES } from '../../../tools/tile-packager/src/sources';
import { VIIRS_GIBS_BASE } from '$lib/world/viirs-field';

describe('VIIRS layer + date are pinned to one value across packager and runtime', () => {
	it('packages tiles from the same URL the runtime falls back to', () => {
		const packaged = SOURCES['viirs-night-lights'].urlForTile({ z: 7, x: 91, y: 55 });
		expect(packaged.startsWith(VIIRS_GIBS_BASE)).toBe(true);
	});
});
