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
import {
	viirsLayerAlpha,
	roadMaskAlpha,
	roadLayerZoomRange,
	COLOR_TO_ALPHA,
} from '$lib/world/imagery';
import { NIGHT_PALETTE } from '$content/compositions/night';

const CEIL = NIGHT_PALETTE.viirs.maxAlpha;
const CRUISE = 35_000;
/** Mirrors config-tree world.viirsAlphaBoost. Assert at the SHIPPED value. */
const DEFAULT_BOOST = 1.0;

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

	it('keeps a dim halo floor at ground level instead of fading to zero', () => {
		// The altitude gate used to fade VIIRS to 0 by 5k ft — exactly where
		// flyover beats live — leaving low-altitude night terrain a black void.
		// The floor keeps maxAlpha × lowAltFloor as pooled city glow under the
		// road mask (roads carry structure; VIIRS carries the halo).
		const floor = NIGHT_PALETTE.viirs.lowAltFloor;
		expect(viirsLayerAlpha(1.0, 5.0, 5_000, DEFAULT_BOOST)).toBeCloseTo(CEIL * floor, 3);
		expect(viirsLayerAlpha(1.0, 5.0, 0, DEFAULT_BOOST)).toBeCloseTo(CEIL * floor, 3);
	});

	// ─── ⚠ THE REGRESSION THIS PINS ─────────────────────────────────────────
	// The test above passes scale 1.0 (gain 0.2), which keeps the gate product
	// under 1 and so never exercised the clamp. At the SHIPPED default of 5.0
	// (gain 1.0) with boost 1.4 the product ran 1.07..1.35 across the entire
	// 28-34k night-show band, pinned flat at maxAlpha, and altitude did nothing
	// on any real night show. Always assert at shipped defaults, not at a
	// convenient scale.
	it('keeps altitude expressive at SHIPPED defaults across the show band', () => {
		const at = (alt: number) => viirsLayerAlpha(1.0, 5.0, alt, DEFAULT_BOOST);
		const band = [28_000, 30_000, 32_000, 34_000];
		const alphas = band.map(at);
		for (let i = 1; i < alphas.length; i++) {
			expect(alphas[i]).toBeGreaterThan(alphas[i - 1]);
		}
		// Not merely ordered — meaningfully separated. A near-flat ramp would
		// satisfy monotonicity while still reading as one constant on screen.
		expect(alphas[alphas.length - 1] - alphas[0]).toBeGreaterThan(0.05);
	});

	it('holds the deep-night level at the reference altitude', () => {
		// 30,000 ft is the night altitude the city shows sit at. Guards against a
		// maxAlpha edit silently changing the look while the ratios still pass.
		expect(viirsLayerAlpha(1.0, 5.0, 30_000, DEFAULT_BOOST)).toBeCloseTo(0.25, 2);
	});

	it('goes inert if alphaBoost is raised — the regression, pinned', () => {
		// Documents WHY the default is 1.0. At 1.4 the gate product exceeds 1 at
		// every show altitude and clamps flat, so altitude stops mattering.
		const flat = [28_000, 34_000].map((a) => viirsLayerAlpha(1.0, 5.0, a, 1.4));
		expect(flat[0]).toBeCloseTo(flat[1], 6); // identical == gate disabled
	});

	it('stays under the road mask so structure reads over fill', () => {
		// VIIRS caps at zoom 8 (583 m/px — ~88 screen px per sample at 30k ft) so
		// it cannot resolve a building or a road; the z18 road mask (0.57 m/px)
		// carries the structure. If this ever inverts, the city is a blob again.
		for (const alt of [28_000, 30_000, 34_000]) {
			expect(roadMaskAlpha(1.0, 5.0, alt)).toBeGreaterThan(
				viirsLayerAlpha(1.0, 5.0, alt, DEFAULT_BOOST) * 2,
			);
		}
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

describe('roadLayerZoomRange', () => {
	// Both local caches (viirs-roads composite AND the cartodb-dark fallback)
	// are baked z4–12. A 0–18 clamp against the local server 404-churns z13+
	// requests at every flyover zoom — the sibling of the @2x bug: local
	// parameters that don't match the packager's layout fail silently.
	it('clamps local layers to the baked z4–12 range', () => {
		expect(roadLayerZoomRange(true)).toEqual({ minimumLevel: 4, maximumLevel: 12 });
	});

	it('leaves the remote CDN at its full z0–18 range', () => {
		expect(roadLayerZoomRange(false)).toEqual({ minimumLevel: 0, maximumLevel: 18 });
	});
});

describe('COLOR_TO_ALPHA (deep-review SSOT)', () => {
	// Cesium keys transparent when distance-to-black ≤ threshold. These
	// values are load-bearing: 0.0 left CartoDB near-black opaque; roads
	// painted a dark sheet. VIIRS true-black only needs a hairline.
	it('keeps road threshold above CartoDB near-black (~0.05–0.08)', () => {
		expect(COLOR_TO_ALPHA.roadThreshold).toBeGreaterThanOrEqual(0.1);
		expect(COLOR_TO_ALPHA.roadThreshold).toBeLessThan(0.25);
	});

	it('keeps VIIRS threshold a hairline above true black only', () => {
		expect(COLOR_TO_ALPHA.viirsThreshold).toBeGreaterThan(0);
		expect(COLOR_TO_ALPHA.viirsThreshold).toBeLessThan(0.05);
		expect(COLOR_TO_ALPHA.viirsThreshold).toBeLessThan(COLOR_TO_ALPHA.roadThreshold);
	});
});
