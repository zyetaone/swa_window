/**
 * world-three/sky — geometry primitives for the Three-side env layers: the
 * sun-direction vector, the air-mass approximation, and the per-phase colour
 * palette.
 *
 * The time-of-day RESPONSE curves (visibility, mood phase, ambient) used to
 * live here too; they moved to world-three/lighting.ts — the single owner of
 * every day/dusk/night response, keyed on the canonical T thresholds. This
 * file now holds only the inputs lighting.ts (and a few layers) build on.
 */

type Vec3 = [number, number, number];

/** Earth's axial tilt (radians) — gives the sun an arc across the year. */
const SUN_TILT = 0.4;

/**
 * World-space placement radius for sun-anchored layers (SunGlow core/halo,
 * LensFlare, EffectStack GodRays source, Moon at anti-sun direction).
 *
 * Previously this 6e7 m constant was duplicated across SunGlow, LensFlare,
 * EffectStack, and Moon — silent drift risk if anyone changed one without
 * the others. Single source of truth lives here; consumers import it.
 *
 * 60,000 km is "past every other Three-side scene asset" + "inside
 * camera.far (1e9)" → sun layers stay behind clouds in depth order
 * while remaining safely renderable.
 */
export const SUN_PLACEMENT_M = 6e7;

/**
 * World-space unit vector toward the sun for the given camera longitude
 * (deg) and time-of-day (hours 0-24). Matches the geoToCartesian Z-negation
 * convention so the result composes correctly with our Three.js scene.
 *
 *   t=0  → opposite side (midnight)
 *   t=6  → east of camera (dawn)
 *   t=12 → overhead (noon)
 *   t=18 → west of camera (dusk)
 *
 * Memoised: returns the same Vec3 array for identical (camLonDeg, timeOfDay)
 * inputs. Since multiple components (SunGlow, Moon, LensFlare, AtmosphericVeil,
 * ThreeOverlay, EffectStack) each compute this independently in their respective
 * $derived / $effect blocks, the memo collapses 6-8 calls into 1 trig
 * evaluation per frame when inputs are shared.
 *
 * ⚠ ALIASING WARNING: the returned reference is shared across callers and
 * mutated in place on cache miss. Safe for the dominant pattern (caller
 * immediately reads d[0]/d[1]/d[2] and computes a derived value
 * synchronously). UNSAFE if a caller stores the reference and reads from
 * it later — by then another call may have rewritten _sunMemo.result.
 * Don't capture; always read-and-derive in the same synchronous block.
 */
const _sunMemo: { camLonDeg: number; timeOfDay: number; result: Vec3 } = {
	camLonDeg: Infinity,
	timeOfDay: Infinity,
	result: [0, 0, 0],
};
export function computeSunDirection(camLonDeg: number, timeOfDay: number): Vec3 {
	if (camLonDeg === _sunMemo.camLonDeg && timeOfDay === _sunMemo.timeOfDay) {
		return _sunMemo.result;
	}
	const sunLonRad = ((camLonDeg + 180 - timeOfDay * 15) * Math.PI) / 180;
	const cosTilt = Math.cos(SUN_TILT);
	_sunMemo.result[0] = cosTilt * Math.cos(sunLonRad);
	_sunMemo.result[1] = Math.sin(SUN_TILT);
	_sunMemo.result[2] = -cosTilt * Math.sin(sunLonRad);
	_sunMemo.camLonDeg = camLonDeg;
	_sunMemo.timeOfDay = timeOfDay;
	return _sunMemo.result;
}

/**
 * Simple air-mass approximation for low-sun atmospheric effects.
 * Used by multiple artistic layers for realistic horizon bloom / dimming.
 * Tightened epsilon gives stronger response near the horizon.
 */
export function airMassFactor(camLonDeg: number, timeOfDay: number): number {
	const d = computeSunDirection(camLonDeg, timeOfDay);
	const elev = Math.max(-0.12, Math.min(1, d[1]));
	return 1.0 / Math.max(0.12, elev + 0.12);
}

// SKY_PALETTE now lives in the framework-free $lib/world-lighting/curves (so the
// Cesium side can read it too, not just Three). Re-exported here for the Three
// layers + shell components that import it from './sky'.
export { SKY_PALETTE } from '$lib/world-lighting/curves';
