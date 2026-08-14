/**
 * Imagery layer composite order — base → VIIRS → road mask.
 *
 * "Roads carry the city; VIIRS fills behind" (see roadMaskAlpha): the z18
 * road strokes must composite ON TOP of the coarse VIIRS glow. With the order
 * inverted, VIIRS muted road strokes by up to maxAlpha exactly where both
 * peak (city cores) and its near-black pixels (threshold keys only TRUE
 * black) darkened them further.
 *
 * The order exists only inside the networked setupImagery(), so — like the
 * shader-contract test — this reads the source from disk instead of mounting
 * a viewer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/lib/world/imagery.ts', 'utf8');

describe('imagery layer order', () => {
	it('VIIRS is added before the road mask (roads composite on top)', () => {
		const viirs = src.indexOf('_viirsLayer = _addLayer');
		const road = src.indexOf('_roadMaskLayer = _addLayer');
		expect(viirs).toBeGreaterThan(-1);
		expect(road).toBeGreaterThan(-1);
		expect(viirs).toBeLessThan(road);
	});
});
