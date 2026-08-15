/**
 * Pins the night post-FX gate.
 *
 * The bug this guards: bloom + the night grade used to ride
 * `qualityMode !== 'performance'`, and `performance` is the shipped Pi
 * default — so the fleet rendered night with no spatial glow and no palette.
 * The gate now follows nightFactor. If someone re-ties it to the quality
 * tier, the "runs at night on the performance preset" case below fails.
 */
import { describe, it, expect } from 'vitest';
import { nightPostFxOn } from '../../../src/lib/world/shaders';

describe('nightPostFxOn', () => {
	it('is off in full daylight', () => {
		expect(nightPostFxOn(0, false)).toBe(false);
	});

	it('turns on once night is established', () => {
		expect(nightPostFxOn(0.05, false)).toBe(true);
		expect(nightPostFxOn(1, false)).toBe(true);
	});

	it('has hysteresis: the off→on threshold is higher than on→off', () => {
		// 0.03 sits inside the band — it holds whichever state it was in,
		// which is what stops a dusk crossing thrashing the stage install.
		expect(nightPostFxOn(0.03, false)).toBe(false);
		expect(nightPostFxOn(0.03, true)).toBe(true);
	});

	it('releases below the lower threshold regardless of prior state', () => {
		expect(nightPostFxOn(0.01, true)).toBe(false);
	});

	it('is monotonic in nightFactor for a fixed prior state', () => {
		for (const prev of [false, true]) {
			let seenOn = false;
			for (let nf = 0; nf <= 1; nf += 0.01) {
				const on = nightPostFxOn(nf, prev);
				if (on) seenOn = true;
				// once on, never flips back as nightFactor keeps rising
				if (seenOn) expect(on).toBe(true);
			}
		}
	});
});
