/**
 * world-three/sky — SSOT for sun direction, time-of-day visibility curves,
 * and the per-phase colour palette that drives every Three-side env layer.
 *
 * Previously these constants + functions lived inline in SunGlow / Moon /
 * LensFlare / AtmosphericVeil / ThreeOverlay (3-4× duplication across
 * components). Centralising here means the dawn/dusk window boundaries
 * (5 / 7.5 / 17 / 19.5) are now a single edit.
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

// Module-scope cached return for environmentAmbient — the function is called
// by multiple $derived consumers every frame during flight. Returning a new
// object literal each call created short-lived GC pressure. Now we mutate
// and return the same cached object (consumers only read, never mutate).
const _envCache: { color: Vec3; intensity: number } = { color: [0, 0, 0], intensity: 0 };

/**
 * Returns a more physically grounded ambient tint + intensity for the
 * Three-side environment (the base AmbientLight in the hybrid overlay).
 *
 * It keeps the artistic phase-based mood windows (dawn/dusk hero moments)
 * from the palette, but modulates them with air mass (stronger scatter
 * near horizon) and nightFactor. This makes the overall "environment"
 * feel more consistent with the upgraded individual sky layers.
 */
export function environmentAmbient(
	camLonDeg: number,
	timeOfDay: number,
	nightFactor: number
): { color: Vec3; intensity: number } {
	const phase = skyMood(timeOfDay).phase;
	const base = SKY_PALETTE.ambient[phase];

	const am = airMassFactor(camLonDeg, timeOfDay);
	// Horizon boost for the base environment (stronger at low sun)
	const horizonBoost = 1 + Math.min(0.8, (am - 1) * 0.25);

	// NightFactor already dims things, but we can give a little extra
	// cool shift near the horizon at night for depth.
	const nf = nightFactor;
	const coolShift = nf * 0.15;

	_envCache.color[0] = Math.max(0, base[0] * horizonBoost);
	_envCache.color[1] = Math.max(0, base[1] * horizonBoost * (1 - coolShift * 0.6));
	_envCache.color[2] = Math.max(0, base[2] * horizonBoost * (1 - coolShift * 0.4) + coolShift * 0.1);

	// Night floor dropped from 0.45 → 0.12: prior floor made nighttime
	// clouds + ground glow too bright. Day peak now 0.90 (was 0.90).
	_envCache.intensity = 0.12 + (1 - nf) * 0.78;

	return _envCache;
}

/**
 * Visibility curve for sun-anchored env layers (SunGlow, LensFlare,
 * AtmosphericVeil): peaks during the dawn/dusk windows, residual midday
 * lift, zero at deep night. Sine interpolation gives smooth ramps.
 */
export function sunVisibility(timeOfDay: number): number {
	const t = timeOfDay;
	if (t >= 5 && t <= 8)        return Math.sin(((t - 5) / 3) * Math.PI);
	if (t >= 17 && t <= 20)      return Math.sin(((t - 17) / 3) * Math.PI);
	if (t > 8 && t < 17)         return 0.35;
	return 0;
}

export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night';

/**
 * Sky mood from time-of-day. `phase` selects the palette below; `intensity`
 * is the sine-curve ramp within dawn/dusk transitions (1 at peak), used
 * for crossfading between palettes if a consumer wants more nuance.
 */
export function skyMood(timeOfDay: number): { phase: SkyPhase; intensity: number } {
	const t = timeOfDay;
	if (t >= 5 && t <= 7.5)     return { phase: 'dawn',  intensity: Math.sin(((t - 5)  / 2.5) * Math.PI) };
	if (t >= 17 && t <= 19.5)   return { phase: 'dusk',  intensity: Math.sin(((t - 17) / 2.5) * Math.PI) };
	if (t > 7.5 && t < 17)      return { phase: 'day',   intensity: 1 };
	return                              { phase: 'night', intensity: 1 };
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
