/**
 * city-lights palette — the warm "city at night" colour family.
 *
 * ─── WHY ────────────────────────────────────────────────────────────────────
 * One named home for the night-light hues so the lit city reads as a single
 * place across its layers. The 3 canonical stops mirror the Cesium post-process
 * night grade (the authored source of the look, src/lib/world/shaders.ts):
 * sodium → amber → warm-white, plus a rare cool-LED accent — the only non-warm
 * note a real city throws.
 *
 * ─── WHO READS IT ───────────────────────────────────────────────────────────
 * The Three-side float/hex consumers import the named entries DIRECTLY:
 *   • CityGlowDome  → CITY_GLOW (the diffuse skyglow tint)
 *   • OsmRoads      → STREET_CORE / STREET_HALO (neon street tracing)
 *
 * The GLSL layers (CityLightField bokeh, world/building-shader windows,
 * world/shaders.ts grade) deliberately keep INLINE vec3 literals — per-fragment
 * variety + no JS↔shader-string coupling — but treat these as the reference so
 * the whole family stays coherent. A full "every layer reads one palette" merge
 * was explored and rejected: the hues are role-differentiated (glow ≠ street ≠
 * window grades ≠ grade stops) across five representations, so collapsing them
 * would flatten intentional variety, not remove real duplication.
 *
 * Pure constants (no Math.random) → 3-Pi panorama safe (invariant #4).
 */

export type Rgb = readonly [number, number, number];

/** Canonical 3-stop warm grade — mirrors the Cesium night shader stops. */
export const CITY_SODIUM: Rgb = [1.0, 0.6, 0.2];
export const CITY_AMBER: Rgb = [1.0, 0.8, 0.4];
export const CITY_WARM_WHITE: Rgb = [1.0, 0.88, 0.72];
/** Rare cool LED/mercury accent — the only non-warm note in a lit city. */
export const CITY_COOL_LED: Rgb = [0.78, 0.86, 1.0];

/** Diffuse skyglow tint thrown up into the haze (CityGlowDome) — a deeper,
 *  less-saturated amber than the point sources so it reads as glow, not lamps. */
export const CITY_GLOW: Rgb = [1.0, 0.55, 0.2];

/** OsmRoads warm-sodium street neon: core is the bright line, halo the softer
 *  bloom underneath. (= 0xffc77a / 0xdca860, kept exact.) */
export const STREET_CORE: Rgb = [1.0, 0.78, 0.478];
export const STREET_HALO: Rgb = [0.863, 0.659, 0.376];

/** Pack a 0..1 Rgb into a Three hex int (0xRRGGBB) for material colour props. */
export function hexOf(c: Rgb): number {
	return (
		(Math.round(c[0] * 255) << 16) |
		(Math.round(c[1] * 255) << 8) |
		Math.round(c[2] * 255)
	);
}
