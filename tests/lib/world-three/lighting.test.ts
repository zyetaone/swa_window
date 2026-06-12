import { describe, it, expect } from 'vitest';
import { lightingState } from '$lib/world-three/lighting';
import { SKY_PALETTE } from '$lib/world-three/sky';
import { nightFactor } from '$lib/utils';

// NOTE: lightingState returns a SHARED, mutated-in-place object. Any test that
// compares two calls MUST snapshot scalars/arrays before the next call.

describe('lighting — unified day/dusk/night SSOT', () => {
	it('sunContribution is 1 by day and a HARD 0 by deep night (kills gold-night)', () => {
		expect(lightingState(12, 0).sunContribution).toBe(1);
		// Deep night: nf = 1 → no sun contribution at all.
		expect(lightingState(1, 1).sunContribution).toBe(0);
		expect(lightingState(23, 1).sunContribution).toBe(0);
		// Dusk: partial, strictly between.
		const dusk = lightingState(19, nightFactor(19)).sunContribution;
		expect(dusk).toBeGreaterThan(0);
		expect(dusk).toBeLessThan(1);
	});

	it('nightDarkness mirrors clamped nightFactor', () => {
		expect(lightingState(12, 0).nightDarkness).toBe(0);
		expect(lightingState(1, 1).nightDarkness).toBe(1);
		expect(lightingState(19, 0.5).nightDarkness).toBe(0.5);
		// Clamped.
		expect(lightingState(1, 5).nightDarkness).toBe(1);
		expect(lightingState(12, -3).nightDarkness).toBe(0);
	});

	it('dawnDuskWeight peaks in the transition, is 0 at full day/night, capped at 0.75', () => {
		expect(lightingState(12, 0).dawnDuskWeight).toBe(0); // full day
		expect(lightingState(1, 1).dawnDuskWeight).toBe(0); // full night
		// Just inside the dawn/dusk band (the warm peak sits adjacent to the
		// day boundary, where dawnDuskFactor itself snaps to 0) → capped.
		expect(lightingState(6.9, nightFactor(6.9)).dawnDuskWeight).toBeCloseTo(0.75, 5);
		expect(lightingState(18.1, nightFactor(18.1)).dawnDuskWeight).toBeCloseTo(0.75, 5);
		// Never exceeds the cap.
		for (let t = 5; t <= 21; t += 0.25) {
			expect(lightingState(t, nightFactor(t)).dawnDuskWeight).toBeLessThanOrEqual(0.75 + 1e-9);
		}
	});

	it('cityGlowAmount is 0 in day, gates in past nf 0.32 (evening recalibration)', () => {
		expect(lightingState(12, 0).cityGlowAmount).toBe(0);
		// Gate moved 0.45 → 0.32 so the city's warm glow rises through the
		// evening band (value-pin updated alongside curves.ts).
		expect(lightingState(18.3, 0.32).cityGlowAmount).toBe(0);
		expect(lightingState(19, 0.45).cityGlowAmount).toBeGreaterThan(0);
		const mid = lightingState(20, 0.8).cityGlowAmount;
		expect(mid).toBeGreaterThan(0);
		expect(mid).toBeLessThanOrEqual(1);
		// Still reaches exactly 1 at deep night.
		expect(lightingState(23, 1).cityGlowAmount).toBe(1);
	});

	it('starVisibility ramps from late dusk (nf > 0.4)', () => {
		expect(lightingState(18, 0.4).starVisibility).toBe(0);
		expect(lightingState(20, 0.7).starVisibility).toBeCloseTo(0.45, 5);
		expect(lightingState(1, 1).starVisibility).toBeCloseTo(0.9, 5);
	});

	it('moonContribution ramps from early dusk (nf > 0.15) and clamps to 1', () => {
		expect(lightingState(18, 0.15).moonContribution).toBe(0);
		expect(lightingState(19, 0.5).moonContribution).toBeCloseTo(0.413, 3);
		expect(lightingState(1, 1).moonContribution).toBe(1);
	});

	it('ambientIntensity matches the legacy 0.12 + (1 - nf) * 0.78 curve', () => {
		expect(lightingState(12, 0).ambientIntensity).toBeCloseTo(0.9, 6);
		expect(lightingState(1, 1).ambientIntensity).toBeCloseTo(0.12, 6);
		expect(lightingState(19, 0.5).ambientIntensity).toBeCloseTo(0.51, 6);
	});

	it('skyTint resolves to the palette extremes at full day / deep night', () => {
		const day = [...lightingState(12, 0).skyTint];
		expect(day).toEqual(SKY_PALETTE.veil.day as unknown as number[]);
		const night = [...lightingState(1, 1).skyTint];
		expect(night).toEqual(SKY_PALETTE.veil.night as unknown as number[]);
	});

	it('skyTint is continuous across the old phase seam (no banding)', () => {
		// The legacy skyMood() hard-switched at 17:00 → a visible seam. The
		// continuous blend must agree on both sides of a window boundary.
		const before = [...lightingState(17.999, nightFactor(17.999)).skyTint];
		const after = [...lightingState(18.001, nightFactor(18.001)).skyTint];
		for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(before[i], 2);
	});

	it('returns a stable shared reference (allocation-free contract)', () => {
		const r1 = lightingState(12, 0);
		const r2 = lightingState(1, 1);
		expect(r1).toBe(r2); // same object every call — read synchronously
	});

	it('is a pure deterministic function of its inputs (3-Pi safety)', () => {
		const a = lightingState(19.3, nightFactor(19.3));
		const snapshot = { sun: a.sunContribution, night: a.nightDarkness, dd: a.dawnDuskWeight };
		lightingState(6, 0.8); // perturb the shared object
		const b = lightingState(19.3, nightFactor(19.3));
		expect(b.sunContribution).toBe(snapshot.sun);
		expect(b.nightDarkness).toBe(snapshot.night);
		expect(b.dawnDuskWeight).toBe(snapshot.dd);
	});

	it('sunGlowVisibility is a 0.35 day plateau, hero-peaks in dawn/dusk, 0 at night', () => {
		expect(lightingState(12, 0).sunGlowVisibility).toBeCloseTo(0.35, 6); // day plateau
		expect(lightingState(1, 1).sunGlowVisibility).toBe(0); // night
		expect(lightingState(23, 1).sunGlowVisibility).toBe(0); // night
		// Dawn/dusk peaks rise above the day plateau (hero glow).
		expect(lightingState(6, nightFactor(6)).sunGlowVisibility).toBeGreaterThan(0.35);
		expect(lightingState(19.5, nightFactor(19.5)).sunGlowVisibility).toBeGreaterThan(0.35);
	});

	it('skyTurbidity / skyRayleigh stay finite and clearer by day', () => {
		const day = lightingState(12, 0);
		const dayTurb = day.skyTurbidity;
		const dayRay = day.skyRayleigh;
		const night = lightingState(1, 1);
		expect(Number.isFinite(dayTurb)).toBe(true);
		expect(Number.isFinite(dayRay)).toBe(true);
		// Day is clearer (lower turbidity) and bluer (higher rayleigh) than deep night.
		expect(dayTurb).toBeLessThan(night.skyTurbidity);
		expect(dayRay).toBeGreaterThan(night.skyRayleigh);
	});
});
