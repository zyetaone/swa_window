/**
 * world/sky — sun-position math for the Three-side env layers: the
 * sun-direction vector and the local solar elevation that feeds horizon
 * effects (air mass, low-sun warm shift).
 *
 * The time-of-day RESPONSE curves (visibility, mood phase, ambient) and the
 * per-phase colour palette (SKY_PALETTE) live in world/curves.ts — the
 * single owner of every day/dusk/night response, keyed on the canonical T
 * thresholds. This file holds only the geometric inputs layers build on.
 */

type Vec3 = [number, number, number];

/** Earth's axial tilt (radians) — gives the sun an arc across the year. */
const SUN_TILT = 0.4;

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
 * inputs. Multiple components (ThreeOverlay, EffectStack, Venus, Wing)
 * each compute this independently in their respective
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
 * Sine of the LOCAL solar elevation for an observer at `latDeg`, at solar
 * `timeOfDay` (hours 0-24). Standard solar-position formula:
 *
 *   sin(elev) = sin(lat)·sin(decl) + cos(lat)·cos(decl)·cos(hourAngle)
 *
 * with declination fixed at SUN_TILT (matching the simplified seasonal model
 * computeSunDirection uses) and hourAngle = (timeOfDay − 12)/24 · 2π.
 *
 * WHY THIS EXISTS: computeSunDirection's Y component is the sun's projection
 * onto the WORLD polar axis (CameraMirror's frame has +Y = north pole), which
 * is a CONSTANT sin(SUN_TILT) — it is NOT the local "how high is the sun"
 * elevation. Every consumer that wants horizon physics (air mass, horizon
 * boost, low-sun warm shift) must use this function, not sunDir[1].
 *
 * Pure, frame-free, deterministic (3-Pi safe — invariant #4).
 *
 *   t=12 noon    → max elevation for the latitude
 *   t=6 / t=18   → ~0 at the equator (sunrise / sunset)
 *   t=0 midnight → max negative (except polar-summer latitudes)
 */
export const DEG2RAD = Math.PI / 180;

export function sunElevationSin(latDeg: number, timeOfDay: number): number {
	const lat = latDeg * DEG2RAD;
	const hourAngle = ((timeOfDay - 12) / 24) * Math.PI * 2;
	return (
		Math.sin(lat) * Math.sin(SUN_TILT)
		+ Math.cos(lat) * Math.cos(SUN_TILT) * Math.cos(hourAngle)
	);
}

/**
 * Simple air-mass approximation for low-sun atmospheric effects.
 * Used by multiple artistic layers for realistic horizon bloom / dimming.
 * Tightened epsilon gives stronger response near the horizon.
 *
 * Now driven by the REAL local solar elevation (sunElevationSin) instead of
 * computeSunDirection's constant world-Y — previously this returned ~1.965
 * for every input, freezing every consumer's horizon response at a mid-state
 * constant. Range: ~0.96 (sun overhead) → 1/0.12 ≈ 8.33 (sun at/below the
 * horizon, hard-capped by the elevation clamp).
 */


// Moon phase: Cesium Simon1994PlanetaryPositions handles this via
// atmosphere-manager.ts. Three-side moon billboard also uses Cesium.
