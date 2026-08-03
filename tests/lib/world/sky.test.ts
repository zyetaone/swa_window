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
	sunElevationSin,
	SKY_PALETTE,
	SUN_PLACEMENT_M,
} from '$lib/world/sky';

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
// now lives in $lib/world/curves.ts (lightingState), covered by lighting.test.ts.

describe('sunElevationSin', () => {
	it('peaks at noon and is maximally negative at midnight (equator)', () => {
		// sin(elev) = sin(lat)·sin(decl) + cos(lat)·cos(decl)·cos(hourAngle)
		// At the equator: noon → cos(SUN_TILT); midnight → −cos(SUN_TILT).
		expect(sunElevationSin(0, 12)).toBeCloseTo(Math.cos(SUN_TILT), 6);
		expect(sunElevationSin(0, 0)).toBeCloseTo(-Math.cos(SUN_TILT), 6);
	});
	it('crosses zero at 6h / 18h on the equator (sunrise / sunset)', () => {
		expect(sunElevationSin(0, 6)).toBeCloseTo(0, 6);
		expect(sunElevationSin(0, 18)).toBeCloseTo(0, 6);
	});
	it('is symmetric about noon', () => {
		expect(sunElevationSin(17.4, 9)).toBeCloseTo(sunElevationSin(17.4, 15), 6);
	});
	it('ACTUALLY varies with time of day — the dead-air-mass regression guard', () => {
		// The old physics read computeSunDirection()[1], a CONSTANT — every
		// consumer saw the same mid-state value at all hours. The real
		// elevation must differ between noon and dawn.
		expect(sunElevationSin(17.4, 12)).not.toBeCloseTo(sunElevationSin(17.4, 6), 2);
	});
	it('shows midnight sun at high latitudes (decl = SUN_TILT keeps it up)', () => {
		// lat 70°N with declination 0.4 rad ≈ 22.9° → the sun never sets.
		expect(sunElevationSin(70, 0)).toBeGreaterThan(0);
	});
	it('is deterministic — same inputs, same output (3-Pi safety)', () => {
		expect(sunElevationSin(17.4, 19.25)).toBe(sunElevationSin(17.4, 19.25));
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
