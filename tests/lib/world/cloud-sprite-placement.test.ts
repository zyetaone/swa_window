/**
 * cloud-sprite-placement — shared geometry for both cloud renderers.
 *
 * The property that actually matters is the RNG DRAW ORDER. Both renderers
 * build their deck from a daySeed()-seeded stream so all three Pis in a
 * panorama agree (invariant #4), and the two renderers interleave different
 * draws between position and scale:
 *
 *   Cesium: ox, oz, oy → brightness, opacity → sprScale → texture
 *   Three : ox, oz, oy → sprite index        → sprScale
 *
 * That is why position and scale are separate calls. A combined helper would
 * consume the scale draw early and hand the Cesium path its brightness value
 * as a scale — silently different clouds. These tests pin the draw counts and
 * the exact values against the pre-refactor inline maths.
 */
import { describe, it, expect } from 'vitest';
import { createSeededRng } from '$lib/world/prng';
import {
	metresToGeoDelta,
	spriteOffset,
	spriteScale,
	SPRITE_SPREAD_XZ,
	SPRITE_SPREAD_Y,
	ANCHOR_SCALE,
	SPRITE_SCALE_MIN,
	SPRITE_SCALE_SPAN,
} from '$lib/world/cloud-sprite-placement';

const SEED = 20260804;
const CX = 100, CH = 7000, CZ = -250, BASE = 40;

/** The exact inline expressions that lived in both renderers before extraction. */
function legacyOffset(i: number, rng: () => number) {
	const isAnchor = i === 0;
	const ox = isAnchor ? CX : CX + (rng() - 0.5) * BASE * 1.85;
	const oz = isAnchor ? CZ : CZ + (rng() - 0.5) * BASE * 1.85;
	const oy = isAnchor ? CH : CH + (rng() - 0.5) * BASE * 0.18;
	return { ox, oy, oz };
}
const legacyScale = (i: number, rng: () => number) =>
	BASE * (i === 0 ? 1.25 : 0.95 + rng() * 0.5);

describe('cloud sprite placement', () => {
	it('reproduces the pre-refactor offsets exactly', () => {
		for (const i of [0, 1, 2, 7]) {
			const a = spriteOffset(i, CX, CH, CZ, BASE, createSeededRng(SEED));
			const b = legacyOffset(i, createSeededRng(SEED));
			expect(a).toEqual(b);
		}
	});

	it('reproduces the pre-refactor scale exactly', () => {
		for (const i of [0, 1, 5]) {
			expect(spriteScale(i, BASE, createSeededRng(SEED)))
				.toBe(legacyScale(i, createSeededRng(SEED)));
		}
	});

	// Draw-count is the contract: it determines every LATER value in the stream.
	it('consumes exactly 3 rng draws for a non-anchor offset, 0 for the anchor', () => {
		let calls = 0;
		const counting = (rng: () => number) => () => { calls++; return rng(); };

		calls = 0;
		spriteOffset(0, CX, CH, CZ, BASE, counting(createSeededRng(SEED)));
		expect(calls).toBe(0);

		calls = 0;
		spriteOffset(1, CX, CH, CZ, BASE, counting(createSeededRng(SEED)));
		expect(calls).toBe(3);
	});

	it('consumes exactly 1 rng draw for a non-anchor scale, 0 for the anchor', () => {
		let calls = 0;
		const counting = (rng: () => number) => () => { calls++; return rng(); };

		calls = 0;
		spriteScale(0, BASE, counting(createSeededRng(SEED)));
		expect(calls).toBe(0);

		calls = 0;
		spriteScale(1, BASE, counting(createSeededRng(SEED)));
		expect(calls).toBe(1);
	});

	// A caller's interleaved draws must survive: position, then N unrelated
	// draws, then scale — exactly how both renderers sequence it.
	it('leaves the caller free to interleave draws between position and scale', () => {
		const rng = createSeededRng(SEED);
		const off = spriteOffset(1, CX, CH, CZ, BASE, rng);
		const brightness = rng();          // Cesium draws these between…
		const opacity = rng();
		const scale = spriteScale(1, BASE, rng);

		// Same stream, computed the old inline way with the same interleave.
		const ref = createSeededRng(SEED);
		const refOff = legacyOffset(1, ref);
		const refBright = ref();
		const refOpac = ref();
		const refScale = legacyScale(1, ref);

		expect(off).toEqual(refOff);
		expect(brightness).toBe(refBright);
		expect(opacity).toBe(refOpac);
		expect(scale).toBe(refScale);
	});

	it('anchors sit exactly at the cluster centre', () => {
		expect(spriteOffset(0, CX, CH, CZ, BASE, createSeededRng(SEED)))
			.toEqual({ ox: CX, oy: CH, oz: CZ });
	});

	it('two Pis with the same seed place sprites identically (invariant #4)', () => {
		const left = createSeededRng(SEED);
		const right = createSeededRng(SEED);
		for (let i = 0; i < 20; i++) {
			expect(spriteOffset(i, CX, CH, CZ, BASE, left))
				.toEqual(spriteOffset(i, CX, CH, CZ, BASE, right));
		}
	});

	it('spread constants keep the deck a slab, not a cube', () => {
		// Vertical spread must stay far tighter than horizontal or the "deck"
		// reads as a cloud BALL from the window.
		expect(SPRITE_SPREAD_Y).toBeLessThan(SPRITE_SPREAD_XZ / 5);
		expect(ANCHOR_SCALE).toBeGreaterThan(SPRITE_SCALE_MIN);
		expect(SPRITE_SCALE_MIN + SPRITE_SCALE_SPAN).toBeGreaterThan(ANCHOR_SCALE);
	});
});

describe('metresToGeoDelta', () => {
	// One degree of latitude is ~111.32 km at EVERY latitude; one degree of
	// longitude shrinks as cos(lat). The Cesium billboard layer inlined this
	// twice with the cos on the wrong axis, squashing the deck east-west and
	// stretching it north-south. These tests fail against that old maths.
	const M_PER_DEG_LAT = 111_320;

	it('keeps the latitude scale constant with latitude', () => {
		const north = 20_000;
		const atEquator = metresToGeoDelta(0, north, 0).lat;
		for (const lat of [17.44, 25.2, 36.17, 41.79, 60]) {
			expect(metresToGeoDelta(0, north, lat).lat).toBeCloseTo(atEquator, 12);
		}
	});

	it('shrinks the longitude scale by cos(lat)', () => {
		const east = 20_000;
		const atEquator = metresToGeoDelta(east, 0, 0).lon;
		for (const lat of [17.44, 36.17, 41.79]) {
			const expected = atEquator / Math.cos((lat * Math.PI) / 180);
			expect(metresToGeoDelta(east, 0, lat).lon).toBeCloseTo(expected, 12);
		}
		// A degree of longitude is SHORTER away from the equator, so covering the
		// same ground distance takes MORE degrees.
		expect(metresToGeoDelta(east, 0, 41.79).lon).toBeGreaterThan(atEquator);
	});

	it('round-trips an east/north offset back to the input metres', () => {
		// This is the check the old code fails: it lands ~5 km short east and
		// ~6.8 km long north at Chicago for a 20 km offset.
		for (const lat of [0, 17.44, 25.2, 36.17, 41.79]) {
			const cos = Math.cos((lat * Math.PI) / 180);
			const d = metresToGeoDelta(20_000, 20_000, lat);
			expect(d.lon * M_PER_DEG_LAT * cos).toBeCloseTo(20_000, 6);
			expect(d.lat * M_PER_DEG_LAT).toBeCloseTo(20_000, 6);
		}
	});

	it('does not diverge at the pole', () => {
		expect(Number.isFinite(metresToGeoDelta(1000, 1000, 90).lon)).toBe(true);
	});

	it('is deterministic — same inputs, same delta on every Pi (invariant #4)', () => {
		const a = metresToGeoDelta(1234, -567, 36.17);
		const b = metresToGeoDelta(1234, -567, 36.17);
		expect(a).toEqual(b);
	});
});
