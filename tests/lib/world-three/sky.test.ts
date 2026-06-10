/**
 * Coverage for the Three.js-side sky math helpers.
 *
 * Visual layer was previously zero-tested. These property-tests document
 * the math contracts (sun direction is a unit vector, sky phases align
 * with documented time bands, air-mass factor blows up correctly at low
 * elevations, etc.) so any accidental drift in the formulas surfaces as
 * a CI signal instead of a visual regression nobody catches until install.
 */
import { describe, it, expect } from 'vitest';
import {
	computeSunDirection,
	airMassFactor,
	SKY_PALETTE,
	SUN_PLACEMENT_M,
} from '$lib/world-three/sky';

const SUN_TILT = 0.4; // matches the private constant in sky.ts

describe('SUN_PLACEMENT_M', () => {
	it('is the documented 60,000 km value', () => {
		expect(SUN_PLACEMENT_M).toBe(6e7);
	});
});

describe('computeSunDirection', () => {
	it('returns a unit-length vector for any time-of-day', () => {
		for (const t of [0, 6, 12, 18, 23.5]) {
			const d = computeSunDirection(0, t);
			const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
			expect(len).toBeCloseTo(1, 5);
		}
	});
	it('y-component is constant — sin(SUN_TILT) — independent of time/longitude', () => {
		// The sun's "elevation" out of the equatorial plane is fixed by
		// Earth's axial tilt. timeOfDay and camLon only rotate the sun
		// around the polar axis; they don't change y.
		const expected = Math.sin(SUN_TILT);
		expect(computeSunDirection(0, 0)[1]).toBeCloseTo(expected, 6);
		expect(computeSunDirection(0, 12)[1]).toBeCloseTo(expected, 6);
		expect(computeSunDirection(180, 6)[1]).toBeCloseTo(expected, 6);
	});
	it('sun is opposite at midnight vs noon (xz-plane)', () => {
		// computeSunDirection memoises and returns a SHARED mutated array on
		// each call. To compare results across two calls, capture each call's
		// values as primitives first — capturing the reference would just
		// give you twice the most recent call's data.
		const noonD = computeSunDirection(0, 12);
		const noonX = noonD[0], noonZ = noonD[2];
		const midD = computeSunDirection(0, 0);
		const midX = midD[0], midZ = midD[2];
		expect(midX).toBeCloseTo(-noonX, 5);
		expect(midZ).toBeCloseTo(-noonZ, 5);
	});

	it('memo aliasing: two sequential calls return the same reference', () => {
		// Document the aliasing contract — this is the behavior callers
		// must work around. If a caller stores the reference and reads
		// later, they'll see whatever the most recent call wrote.
		const a = computeSunDirection(0, 6);
		const b = computeSunDirection(0, 18);
		expect(a).toBe(b); // same reference
		// And the values are the LAST call's (midnight-ish), not the first.
		const fresh = computeSunDirection(0, 18);
		expect(a[0]).toBe(fresh[0]);
	});
});

// skyMood + sunVisibility retired from sky.ts — their day/dusk/night response
// now lives in world-three/lighting.ts (lightingState), covered by lighting.test.ts.

describe('airMassFactor', () => {
	it('returns the elevation-floor value when sun is high', () => {
		// y at noon = sin(SUN_TILT) ≈ 0.389. airMass = 1/(0.389+0.12) ≈ 1.964.
		const expected = 1 / (Math.sin(SUN_TILT) + 0.12);
		expect(airMassFactor(0, 12)).toBeCloseTo(expected, 4);
	});
	it('blows up safely (capped) when sun is below horizon (night)', () => {
		// At midnight y is large negative; the elev clamp at -0.12 + 0.12 = 0
		// would divide by zero — code clamps to Math.max(0.12, …) → ceiling.
		const result = airMassFactor(0, 0);
		expect(result).toBeGreaterThan(0);
		expect(result).toBeLessThanOrEqual(1 / 0.12); // hard ceiling
	});
});

// environmentAmbient retired from sky.ts — ambient color/intensity now comes
// from lightingState (lighting.test.ts pins the 0.12 + (1-nf)*0.78 curve).

describe('SKY_PALETTE', () => {
	it('has entries for every (layer, phase) combination', () => {
		const layers = ['sunCore', 'veil', 'ambient'] as const;
		const phases = ['dawn', 'day', 'dusk', 'night'] as const;
		for (const layer of layers) {
			for (const phase of phases) {
				const rgb = SKY_PALETTE[layer][phase];
				expect(rgb).toBeDefined();
				expect(rgb.length).toBe(3);
				expect(rgb.every((c) => c >= 0 && c <= 2)).toBe(true);
			}
		}
	});
	it('night ambient is cool (B > R) — guards against accidental warm tint at night', () => {
		const [r, , b] = SKY_PALETTE.ambient.night;
		expect(b).toBeGreaterThan(r);
	});
	it('dusk veil is warm (R > B) — guards against accidental cool tint at sunset', () => {
		const [r, , b] = SKY_PALETTE.veil.dusk;
		expect(r).toBeGreaterThan(b);
	});
});
