/**
 * Night imagery layer alphas.
 *
 * Both of these are multiplied by operator knobs (`nightLightScale` at a 5.0
 * default, plus an alpha boost), and both were clamped wrongly:
 *
 *   VIIRS      clamped to 1.0 rather than to its own palette ceiling (0.8)
 *   road mask  not clamped at all (observed live: alpha = 3.664)
 *
 * Cesium treats alpha >= 1 as fully opaque, so the layers saturated: the night
 * scene read as a flat amber wash, the altitude gates could not fade anything,
 * and most of the operator's slider travel was inert.
 *
 * These were invisible to the suite because the layers are module-private and
 * only exist after a networked setupImagery(). The maths is now pure, so it can
 * be asserted directly.
 */
import { describe, it, expect } from 'vitest';
import { viirsLayerAlpha, roadMaskAlpha } from '$lib/world/imagery';
import { NIGHT_PALETTE } from '$content/compositions/night';

const CEIL = NIGHT_PALETTE.viirs.maxAlpha;
const CRUISE = 35_000;

describe('viirsLayerAlpha', () => {
	it('never exceeds the palette ceiling, even at max operator gain', () => {
		for (const nf of [0.6, 0.8, 0.95, 1.0]) {
			for (const alt of [10_000, 28_000, CRUISE, 45_000]) {
				// scale 5.0 = slider max = the shipped default.
				expect(viirsLayerAlpha(nf, 5.0, alt, 1.4)).toBeLessThanOrEqual(CEIL + 1e-9);
			}
		}
	});

	it('is never fully opaque — the tiles must read as lit terrain, not a wash', () => {
		expect(viirsLayerAlpha(1.0, 5.0, CRUISE, 1.4)).toBeLessThan(1.0);
	});

	it('leaves the operator slider meaningful across its range', () => {
		// The bug: alpha pinned from scale ~0.9 up, so 82% of 0..5 did nothing.
		const at = (s: number) => viirsLayerAlpha(1.0, s, CRUISE, 1.4);
		const samples = [0.5, 1, 2, 3, 4, 5].map(at);
		const distinct = new Set(samples.map((v) => v.toFixed(4)));
		expect(distinct.size).toBeGreaterThan(3);
		// And it must still be monotonic — more gain, never less light.
		for (let i = 1; i < samples.length; i++) {
			expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 1e-9);
		}
	});

	it('stays dark before the smoothstep floor', () => {
		expect(viirsLayerAlpha(0.3, 5.0, CRUISE, 1.4)).toBe(0);
	});

	it('fades toward the ground — VIIRS is the FAR layer', () => {
		// Low altitude hands over to near-detail layers, so alpha must drop.
		expect(viirsLayerAlpha(1.0, 1.0, 8_000, 1.4)).toBeLessThan(
			viirsLayerAlpha(1.0, 1.0, CRUISE, 1.4),
		);
	});

	it('honours bootFade', () => {
		expect(viirsLayerAlpha(1.0, 5.0, CRUISE, 1.4, 0)).toBe(0);
	});
});

describe('roadMaskAlpha', () => {
	it('never exceeds 1.0 at any altitude or operator gain', () => {
		for (const nf of [0.5, 1.0]) {
			for (const alt of [5_000, 16_400, 28_000, CRUISE]) {
				expect(roadMaskAlpha(nf, 5.0, alt)).toBeLessThanOrEqual(1.0);
			}
		}
	});

	it('keeps its altitude gate meaningful instead of pinning opaque', () => {
		// Roads are a NEAR layer: stronger low, weaker at cruise. Before the clamp
		// every one of these was >= 1 and therefore identical on screen.
		const low = roadMaskAlpha(1.0, 1.0, 5_000);
		const high = roadMaskAlpha(1.0, 1.0, CRUISE);
		expect(low).toBeGreaterThan(high);
	});

	it('is faint but non-zero in daylight', () => {
		const day = roadMaskAlpha(0, 5.0, 28_000);
		expect(day).toBeGreaterThan(0);
		expect(day).toBeLessThan(0.2);
	});
});
