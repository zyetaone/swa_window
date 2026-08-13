/**
 * The 0..5 Night Lights knob must stay EXPRESSIVE across its whole travel.
 *
 * This pins a bug CLASS, not a bug. `world.nightLightIntensity` is a 0..5
 * gain that multiplies into terms authored for ~1. Applied raw it saturates,
 * and saturation does two things at once: it blows out the look, and it
 * silently disables whatever else was multiplying in — the term pins at its
 * ceiling and stops responding to altitude, nightFactor, everything.
 *
 * It has shipped four times (viirsLayerAlpha, roadMaskAlpha, the pollution
 * corona, viirsAlphaBoost). Three of those sites carried comments warning
 * about the trap and a fourth still shipped, so prose is demonstrably not the
 * control. These assertions are.
 *
 * ─── WHY THESE ASSERT RANGE + RESPONSIVENESS, NOT "divides by MAX" ──────────
 * Normalising is not the only correct treatment. buildings.ts deliberately
 * passes the gain RAW and Reinhard tone-maps it in-shader, because dividing
 * down would cost 5x brightness. A test asserting "every consumer divides by
 * NIGHT_LIGHT_SCALE_MAX" would flag that correct code as a false positive.
 *
 * The real invariant is behavioural: at ANY knob position, the output stays
 * in range AND still responds to its other inputs.
 */

import { describe, it, expect } from 'vitest';
import { viirsLayerAlpha, roadMaskAlpha } from '$lib/world/imagery';
import {
	nightLightGain,
	NIGHT_LIGHT_SCALE_MAX,
	NIGHT_EMISSIVE_WHITE_POINT,
} from '$lib/world/altitude';
import { NIGHT_PALETTE } from '$content/compositions/night';

/** Whole knob travel, including the shipped 5.0 default at the top. */
const KNOB = [0, 0.5, 1, 2, 3, 4, 4.5, 5];
/** The altitude band every night show actually flies in. */
const SHOW_BAND = [28_000, 30_000, 32_000, 34_000];
const DEFAULT_BOOST = 1.0;

describe('nightLightGain', () => {
	it('maps the knob onto 0..1', () => {
		expect(nightLightGain(0)).toBe(0);
		expect(nightLightGain(NIGHT_LIGHT_SCALE_MAX)).toBe(1);
		for (const k of KNOB) {
			const g = nightLightGain(k);
			expect(g).toBeGreaterThanOrEqual(0);
			expect(g).toBeLessThanOrEqual(1);
		}
	});

	it('clamps out-of-range input instead of trusting the caller', () => {
		// Fleet config_patch and admin pushes can carry anything.
		expect(nightLightGain(-5)).toBe(0);
		expect(nightLightGain(999)).toBe(1);
		expect(nightLightGain(Number.POSITIVE_INFINITY)).toBe(1);
	});

	it('is strictly monotonic — every slider step does something', () => {
		for (let i = 1; i < KNOB.length; i++) {
			expect(nightLightGain(KNOB[i])).toBeGreaterThan(nightLightGain(KNOB[i - 1]));
		}
	});
});

describe('knob consumers stay in range at every knob position', () => {
	it('viirsLayerAlpha never exceeds the palette ceiling', () => {
		const CEIL = NIGHT_PALETTE.viirs.maxAlpha;
		for (const k of KNOB) {
			for (const nf of [0, 0.5, 0.8, 1]) {
				for (const alt of [10_000, ...SHOW_BAND, 45_000]) {
					expect(viirsLayerAlpha(nf, k, alt, DEFAULT_BOOST)).toBeLessThanOrEqual(CEIL + 1e-9);
				}
			}
		}
	});

	it('roadMaskAlpha never exceeds opaque', () => {
		for (const k of KNOB) {
			for (const nf of [0, 0.5, 1]) {
				for (const alt of [5_000, ...SHOW_BAND]) {
					const a = roadMaskAlpha(nf, k, alt);
					expect(a).toBeGreaterThanOrEqual(0);
					expect(a).toBeLessThanOrEqual(1);
				}
			}
		}
	});
});

describe('saturation never silently disables the altitude gate', () => {
	// THE regression. Range assertions alone would have passed the whole time
	// the gate was dead: alpha sat at exactly maxAlpha, in range and inert.
	it('viirsLayerAlpha still responds to altitude at every knob position', () => {
		for (const k of KNOB) {
			if (k === 0) continue; // gain 0 legitimately flattens everything
			const alphas = SHOW_BAND.map((alt) => viirsLayerAlpha(1, k, alt, DEFAULT_BOOST));
			for (let i = 1; i < alphas.length; i++) {
				expect(
					alphas[i],
					`knob ${k}: alpha pinned flat across the show band — altitude gate is inert`,
				).toBeGreaterThan(alphas[i - 1]);
			}
		}
	});

	it('roadMaskAlpha still responds to altitude at every knob position', () => {
		for (const k of KNOB) {
			if (k === 0) continue;
			// Roads are a NEAR layer — stronger low, weaker at cruise.
			const low = roadMaskAlpha(1, k, 5_000);
			const high = roadMaskAlpha(1, k, 34_000);
			expect(low, `knob ${k}: road alpha pinned flat`).toBeGreaterThan(high);
		}
	});

	it('documents the alphaBoost setting that DOES break the gate', () => {
		// Why world.viirsAlphaBoost ships at 1.0. At 1.4 the product exceeds the
		// ceiling at every show altitude and clamps flat. Raising it re-breaks
		// this, so the failure is pinned rather than left to a comment.
		const flat = [28_000, 34_000].map((a) => viirsLayerAlpha(1, 5, a, 1.4));
		expect(flat[0]).toBeCloseTo(flat[1], 6);
	});
});

describe('the HDR path tone-maps instead of normalising', () => {
	// buildings.ts is the deliberate exception: raw gain in, Reinhard out.
	// Port of the shader's curve — if the white point drifts such that peak
	// emission clips, windows collapse into identical white boxes again.
	const reinhard = (x: number, W: number) => (x * (1 + x / (W * W))) / (1 + x);

	// Measured peaks from the shipped palette at the 5.0 default gain.
	const PEAK_RAW = 7.0;
	const DIMMEST_RAW = 2.79;

	it('does not clip the window palette at the default gain', () => {
		// THE regression: W was 2.2 while the dimmest window is 2.79, so every
		// window exceeded the white point and clamped to pure white — the exact
		// failure tone-mapping was added to prevent. x = W maps to 1.0 by
		// construction, so W must be >= the peak raw value.
		const W = NIGHT_EMISSIVE_WHITE_POINT;
		expect(W, 'white point below peak raw emission — windows clip to white').toBeGreaterThanOrEqual(PEAK_RAW);
		expect(reinhard(PEAK_RAW, W)).toBeLessThanOrEqual(1.0);
		expect(reinhard(DIMMEST_RAW, W)).toBeLessThan(1.0);
	});

	it('keeps dim and bright windows separable — the point of tone-mapping', () => {
		const W = NIGHT_EMISSIVE_WHITE_POINT;
		const dim = reinhard(DIMMEST_RAW, W);
		const bright = reinhard(PEAK_RAW, W);
		// A naive clamp (or a too-low white point) makes both 1.0 and the
		// warm amber/gold palette collapses into identical white boxes.
		expect(bright).toBeGreaterThan(dim);
		expect(bright - dim).toBeGreaterThan(0.1);
	});
});
