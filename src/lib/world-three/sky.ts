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

/**
 * Per-layer × per-phase RGB palette. Each consumer reads `SKY_PALETTE[layer][phase]`.
 * Numbers picked so the dawn/dusk windows read warm-amber and the night
 * is cool-blue across the board.
 */
export const SKY_PALETTE = {
	sunCore: {
		dawn:  [1.0, 0.62, 0.28] as Vec3,
		day:   [1.0, 0.94, 0.82] as Vec3,
		dusk:  [1.0, 0.48, 0.18] as Vec3,
		night: [0.8, 0.45, 0.25] as Vec3, // residual twilight tint
	},
	veil: {
		dawn:  [1.00, 0.55, 0.28] as Vec3,
		day:   [0.85, 0.92, 1.00] as Vec3,
		dusk:  [1.00, 0.40, 0.18] as Vec3,
		night: [0.10, 0.18, 0.40] as Vec3,
	},
	ambient: {
		dawn:  [1.00, 0.78, 0.65] as Vec3,
		day:   [0.95, 0.97, 1.00] as Vec3,
		dusk:  [1.00, 0.66, 0.45] as Vec3,
		night: [0.30, 0.40, 0.65] as Vec3,
	},
} as const;
