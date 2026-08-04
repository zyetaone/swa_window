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
