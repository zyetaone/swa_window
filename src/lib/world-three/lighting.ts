/**
 * world-three/lighting — THE single source of truth for how time-of-day +
 * nightFactor drive every Three-side light/atmosphere layer.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Before this module, ~14 systems (Clouds, AtmosphericVeil, SunGlow, LensFlare,
 * NightStars, Moon, CityGlowDome, the IBL <Sky>, the base AmbientLight, plus the
 * Cesium-side atmosphere) each computed their OWN day/dusk/night response from
 * timeOfDay / nightFactor / airMass — with mismatched thresholds and mixed
 * additive/multiplicative blending. They fought, producing three defects:
 *   • DAY washed out with a banded cyan/yellow horizon (hard phase seam at the
 *     old sky.ts windows 7.5 / 17 + analytical <Sky> fighting the palette).
 *   • DUSK over-saturated to gold (every layer stacked its own warm ramp).
 *   • NIGHT read as perpetual golden-hour, never dark.
 *
 * The night bug had a specific mechanism: `computeSunDirection` returns a
 * CONSTANT y-component (sin(SUN_TILT) ≈ 0.389 — the sun never drops below the
 * horizon in the math), so `airMassFactor` is frozen and every "sun is low"
 * dimming term is a no-op. Warm layers were only gated by nightFactor floors
 * that never reached 0.
 *
 * ─── THE FIX ────────────────────────────────────────────────────────────────
 * One pure function — `lightingState(timeOfDay, nightFactor, sunDir?)` — owns
 * the curves. Every consumer becomes a thin READER of its fields instead of
 * recomputing. `sunContribution` is a pure function of time/nightFactor (NOT of
 * the frozen sun elevation) that reaches a HARD 0 by deep night, so the warm
 * layers actually die. All thresholds collapse onto the canonical `T` constants
 * in $lib/utils so Three and Cesium can never drift apart.
 *
 * ─── CONTRACT ───────────────────────────────────────────────────────────────
 * Pure + allocation-free: returns a SHARED module-scope object mutated in place
 * (mirrors sky.ts `_envCache` / `computeSunDirection` memo). Read fields
 * synchronously in the same block; never capture the reference across frames.
 * Deterministic by construction (no Math.random) → safe for 3-Pi panorama
 * (invariant #4): all three Pis on the same clock produce identical lighting.
 */

import { T, clamp, lerp, smoothstep, getSkyState, dawnDuskFactor } from '$lib/utils';
import type { SkyState } from '$lib/types';
import { SKY_PALETTE } from './sky';

type Vec3 = [number, number, number];

export interface LightingState {
	/** Categorical phase (day | dawn | dusk | night), from the canonical T windows. */
	phase: SkyState;
	/** Warm "golden-hour" hero weight. 0 at full day/night, peaks in the dawn/dusk
	 *  band, eased + capped at 0.75 so dusk never blows out. Consumed ONCE. */
	dawnDuskWeight: number;
	/** How much the sun lights the scene: 1 by day, hard 0 by deep night. Pure
	 *  function of time/nightFactor — the kill-switch for the gold-night warm layers. */
	sunContribution: number;
	/** Visibility curve for the sun-anchored glow layers (SunGlow core/halo,
	 *  EffectStack godrays): a 0.35 daytime plateau with a sine hero-peak through
	 *  the dawn/dusk bands, 0 at night. Owns what sky.ts `sunVisibility` did, now
	 *  on the canonical T windows. */
	sunGlowVisibility: number;
	/** 0 (day) → ~1 (deep night). The single darkening authority for clouds etc. */
	nightDarkness: number;
	/** City skyglow strength 0..1. 0 in day, gated in from mid-dusk (nf > 0.45). */
	cityGlowAmount: number;
	/** Star visibility 0..1, ramps in from late dusk (nf > 0.4). */
	starVisibility: number;
	/** Moon visibility 0..1, ramps in from early dusk (nf > 0.15). */
	moonContribution: number;
	/** Continuous sky/veil colour (no hard phase seam → fixes day banding). */
	skyTint: Vec3;
	/** Continuous warm sun-side / horizon colour. */
	horizonTint: Vec3;
	/** Base ambient tint for the Three environment (env-light). */
	ambientColor: Vec3;
	/** Base ambient intensity (matches the legacy environmentAmbient formula). */
	ambientIntensity: number;
	/** Analytical IBL <Sky> turbidity — lower (clearer/bluer) by day, hazier warm
	 *  at the dawn/dusk horizon. Stops the fixed turbidity from washing out day. */
	skyTurbidity: number;
	/** Analytical IBL <Sky> rayleigh — higher (deeper blue) by day. */
	skyRayleigh: number;
}

// Memo guard so the per-consumer reactive reads (each child calls lightingState
// in its own $derived) collapse to ONE compute per frame: identical inputs →
// return the cached _state without recomputing. Mirrors computeSunDirection's
// memo. `_state` is still the single shared object (read synchronously only).
let _lastT = NaN;
let _lastNf = NaN;
let _lastSunY = NaN;

// Shared, mutated-in-place return value. Consumers only read.
const _state: LightingState = {
	phase: 'day',
	dawnDuskWeight: 0,
	sunContribution: 1,
	sunGlowVisibility: 0.35,
	nightDarkness: 0,
	cityGlowAmount: 0,
	starVisibility: 0,
	moonContribution: 0,
	skyTint: [0, 0, 0],
	horizonTint: [0, 0, 0],
	ambientColor: [0, 0, 0],
	ambientIntensity: 0,
	skyTurbidity: 4,
	skyRayleigh: 3,
};

/**
 * Continuous colour blend across night→dawn→day→dusk→night for one palette
 * layer, written into `out`. Replaces sky.ts `skyMood().phase` HARD switch — the
 * old switch produced a visible seam at 7.5 / 17. Here each transition window is
 * a two-segment lerp (night→edge→day) so the colour is C0-continuous everywhere.
 */
function blendPhase(out: Vec3, layer: keyof typeof SKY_PALETTE, t: number): void {
	const P = SKY_PALETTE[layer];
	let a: Vec3 = P.day;
	let b: Vec3 = P.day;
	let u = 0;
	if (t < T.DAWN_START || t >= T.DUSK_END) {
		a = P.night;
		b = P.night;
	} else if (t < T.DAY_START) {
		// Dawn band: night → dawn (first half) → day (second half).
		const x = (t - T.DAWN_START) / (T.DAY_START - T.DAWN_START);
		if (x < 0.5) {
			a = P.night;
			b = P.dawn;
			u = x * 2;
		} else {
			a = P.dawn;
			b = P.day;
			u = (x - 0.5) * 2;
		}
	} else if (t < T.DAY_END) {
		a = P.day;
		b = P.day;
	} else {
		// Dusk band: day → dusk (first half) → night (second half).
		const x = (t - T.DAY_END) / (T.DUSK_END - T.DAY_END);
		if (x < 0.5) {
			a = P.day;
			b = P.dusk;
			u = x * 2;
		} else {
			a = P.dusk;
			b = P.night;
			u = (x - 0.5) * 2;
		}
	}
	out[0] = lerp(a[0], b[0], u);
	out[1] = lerp(a[1], b[1], u);
	out[2] = lerp(a[2], b[2], u);
}

/**
 * Compute the unified lighting state for the current frame.
 *
 * @param timeOfDay   decimal hours 0..24 (model.timeOfDay)
 * @param nightFactor 0..1 darkness (model.nightFactor — already the √-curve SSOT)
 * @param sunDir      optional sun unit vector (computeSunDirection). Only its
 *                    elevation (y) feeds the ambient horizon boost; everything
 *                    phase-related is time/nightFactor driven by design.
 * @returns the SHARED LightingState — read synchronously, do not capture.
 */
export function lightingState(timeOfDay: number, nightFactor: number, sunDir?: Vec3): LightingState {
	const sunY = sunDir ? sunDir[1] : Math.sin(0.4);
	if (timeOfDay === _lastT && nightFactor === _lastNf && sunY === _lastSunY) {
		return _state;
	}
	_lastT = timeOfDay;
	_lastNf = nightFactor;
	_lastSunY = sunY;

	const nf = clamp(nightFactor, 0, 1);

	_state.phase = getSkyState(timeOfDay);

	// Sun-up amount: pure time/nf, hits hard 0 at deep night (nf = 1 at DUSK_END).
	// This is the term that kills the perpetual golden-hour — the warm layers
	// (SunGlow, Veil, LensFlare, cloud Mie) all scale by this.
	_state.sunContribution = clamp(1 - nf, 0, 1);
	_state.nightDarkness = nf;

	// Sun-glow visibility: sine hero-peak through dawn/dusk, 0.35 day plateau,
	// 0 at night. Same shape sky.ts sunVisibility had, re-based on T windows.
	if (timeOfDay >= T.DAWN_START && timeOfDay < T.DAY_START) {
		_state.sunGlowVisibility = Math.sin(((timeOfDay - T.DAWN_START) / (T.DAY_START - T.DAWN_START)) * Math.PI);
	} else if (timeOfDay > T.DAY_END && timeOfDay <= T.DUSK_END) {
		_state.sunGlowVisibility = Math.sin(((timeOfDay - T.DAY_END) / (T.DUSK_END - T.DAY_END)) * Math.PI);
	} else if (timeOfDay >= T.DAY_START && timeOfDay <= T.DAY_END) {
		_state.sunGlowVisibility = 0.35;
	} else {
		_state.sunGlowVisibility = 0;
	}

	// One warm hero weight, smoothstep-eased and capped so dusk doesn't blow out.
	_state.dawnDuskWeight = Math.min(0.75, smoothstep(dawnDuskFactor(timeOfDay)));

	// City skyglow only from mid-dusk; smooth gate avoids a pop at the boundary.
	_state.cityGlowAmount = nf <= 0.45 ? 0 : smoothstep((nf - 0.45) / 0.55);
	// Stars from late dusk; moon a touch earlier.
	_state.starVisibility = clamp((nf - 0.4) * 1.5, 0, 1);
	_state.moonContribution = clamp((nf - 0.15) * 1.18, 0, 1);

	// Continuous palette — no hard phase seam (fixes day banding).
	blendPhase(_state.skyTint, 'veil', timeOfDay);
	blendPhase(_state.horizonTint, 'sunCore', timeOfDay);
	blendPhase(_state.ambientColor, 'ambient', timeOfDay);

	// Ambient horizon boost + cool night shift — reproduces the legacy
	// environmentAmbient() formula so A1 is a drop-in swap. airMass is derived
	// from the sun elevation when provided (currently ~constant, but correct if
	// the sun arc ever gains real elevation variation).
	const elev = Math.max(-0.12, Math.min(1, sunY));
	const am = 1.0 / Math.max(0.12, elev + 0.12);
	const horizonBoost = 1 + Math.min(0.8, (am - 1) * 0.25);
	const coolShift = nf * 0.15;
	_state.ambientColor[0] = Math.max(0, _state.ambientColor[0] * horizonBoost);
	_state.ambientColor[1] = Math.max(0, _state.ambientColor[1] * horizonBoost * (1 - coolShift * 0.6));
	_state.ambientColor[2] = Math.max(
		0,
		_state.ambientColor[2] * horizonBoost * (1 - coolShift * 0.4) + coolShift * 0.1
	);
	// Intensity floor 0.12 (deep night) → 0.90 (full day). Unchanged from legacy.
	_state.ambientIntensity = 0.12 + (1 - nf) * 0.78;

	// Analytical IBL <Sky> params: clearer + bluer by day (sunContribution → 1),
	// hazier + warmer through the dawn/dusk band so the cubemap matches the
	// palette instead of fighting it. Frozen anyway past nf 0.85 (ThreeOverlay).
	_state.skyTurbidity = lerp(10, 3.2, _state.sunContribution);
	_state.skyRayleigh = lerp(1.4, 3.2, _state.sunContribution);

	return _state;
}
