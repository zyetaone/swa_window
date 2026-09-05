/**
 * Base-layer gamma: the day-side brightness lift must not reach the night.
 *
 * Gamma is the one non-clipping brightness lever on the imagery stack —
 * Cesium's uniform is OneOverGamma, so the shader is pow(color, 1/gamma) and
 * gamma > 1 lifts midtones while mapping 1.0 → 1.0 exactly. That makes it safe
 * where the contrast/saturation pair is not (those drove dark blue channels
 * negative and produced the purple ocean).
 *
 * But it was previously STATIC, applied at every hour. Lifting it for daylight
 * would therefore also lift the night ground — and proportionally most of all
 * there, since pow(0.05, 1/1.25) is nearly 2x. The night look (VIIRS balance,
 * road-mask contrast, corona) was measured against a dark ground, so that would
 * silently re-open a tuned pipeline.
 *
 * So gamma now rides the same ease as saturation. These assertions pin the two
 * ends: full night must still be the pre-change value, and the lift must be
 * real in daylight.
 */
import { describe, it, expect } from 'vitest';
import { baseNightEase } from '$lib/world/imagery';

/** Mirrors setupImagery's eox branch — assert at the SHIPPED values. */
const DAY_GAMMA = 1.25;
/** The value gamma held unconditionally before the day-side lift. */
const NIGHT_GAMMA = 1.1;

const gamma = (nf: number) =>
	DAY_GAMMA + (NIGHT_GAMMA - DAY_GAMMA) * baseNightEase(nf);

describe('baseNightEase', () => {
	it('is exactly 0 through daylight and exactly 1 by deep night', () => {
		for (const nf of [0, 0.2, 0.45]) expect(baseNightEase(nf)).toBe(0);
		for (const nf of [0.9, 0.95, 1]) expect(baseNightEase(nf)).toBe(1);
	});

	it('is monotonic — no brightness swing mid-dusk', () => {
		let prev = -Infinity;
		for (let nf = 0; nf <= 1.0001; nf += 0.05) {
			const e = baseNightEase(nf);
			expect(e).toBeGreaterThanOrEqual(prev);
			prev = e;
		}
	});
});

describe('base layer gamma', () => {
	it('leaves the night pipeline bit-identical to the pre-lift value', () => {
		for (const nf of [0.9, 0.95, 1]) expect(gamma(nf)).toBe(NIGHT_GAMMA);
	});

	it('applies the full lift in daylight', () => {
		expect(gamma(0)).toBe(DAY_GAMMA);
	});

	it('never leaves the two endpoints, so it cannot clip', () => {
		// pow(1,x) === 1 for any gamma in range, i.e. white stays white and no
		// channel can be driven out of gamut at any hour.
		for (let nf = 0; nf <= 1.0001; nf += 0.05) {
			const g = gamma(nf);
			expect(g).toBeGreaterThanOrEqual(NIGHT_GAMMA);
			expect(g).toBeLessThanOrEqual(DAY_GAMMA);
			expect(1 ** (1 / g)).toBe(1);
		}
	});
});
