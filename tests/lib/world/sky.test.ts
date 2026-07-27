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
	airMassFactor,
	moonPhaseFraction,
	moonIlluminatedFraction,
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
// now lives in world-lighting/curves.ts (lightingState), covered by lighting.test.ts.

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

describe('airMassFactor', () => {
	it('returns ~1 (thin air) when the sun is high overhead', () => {
		// Equator noon: sin(elev) = cos(SUN_TILT) ≈ 0.921 → 1/(0.921+0.12).
		const expected = 1 / (Math.cos(SUN_TILT) + 0.12);
		expect(airMassFactor(0, 12)).toBeCloseTo(expected, 4);
	});
	it('hits the hard ceiling when the sun is below the horizon (night)', () => {
		// At midnight sin(elev) is large negative; the elev clamp at −0.12
		// + 0.12 = 0 would divide by zero — code clamps to Math.max(0.12, …).
		const result = airMassFactor(0, 0);
		expect(result).toBeCloseTo(1 / 0.12, 6); // ceiling reached exactly
	});
	it('decreases monotonically from sunrise to noon (real elevation physics)', () => {
		// The whole point of the rewire: low sun → thick air → big factor.
		const dawn = airMassFactor(17.4, 6.5);
		const mid = airMassFactor(17.4, 9);
		const noon = airMassFactor(17.4, 12);
		expect(dawn).toBeGreaterThan(mid);
		expect(mid).toBeGreaterThan(noon);
	});
});

describe('moonPhaseFraction / moonIlluminatedFraction', () => {
	const EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14, 0); // reference new moon
	const SYNODIC_MS = 29.530588853 * 86_400_000;

	it('is 0 at the reference new moon and wraps each synodic month', () => {
		expect(moonPhaseFraction(EPOCH_MS)).toBeCloseTo(0, 6);
		// Exactly one cycle later the float mod can land at 1 − ε — measure
		// circular distance to 0 rather than the raw value.
		for (const n of [1, 3]) {
			const f = moonPhaseFraction(EPOCH_MS + n * SYNODIC_MS);
			expect(Math.min(f, 1 - f)).toBeCloseTo(0, 6);
		}
	});
	it('is 0.5 (full) half a synodic month after new', () => {
		expect(moonPhaseFraction(EPOCH_MS + SYNODIC_MS / 2)).toBeCloseTo(0.5, 6);
	});
	it('stays in [0, 1) including for dates before the epoch', () => {
		for (const ms of [EPOCH_MS - SYNODIC_MS * 2.3, EPOCH_MS + SYNODIC_MS * 321.7]) {
			const f = moonPhaseFraction(ms);
			expect(f).toBeGreaterThanOrEqual(0);
			expect(f).toBeLessThan(1);
		}
	});
	it('illuminated fraction matches the compose.ts (1 − cosΦ)/2 convention', () => {
		expect(moonIlluminatedFraction(EPOCH_MS)).toBeCloseTo(0, 6); // new
		expect(moonIlluminatedFraction(EPOCH_MS + SYNODIC_MS / 2)).toBeCloseTo(1, 6); // full
		expect(moonIlluminatedFraction(EPOCH_MS + SYNODIC_MS / 4)).toBeCloseTo(0.5, 6); // quarter
	});
	it('is deterministic — same timestamp, same phase (3-Pi safety)', () => {
		const t = Date.UTC(2026, 5, 12);
		expect(moonPhaseFraction(t)).toBe(moonPhaseFraction(t));
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
