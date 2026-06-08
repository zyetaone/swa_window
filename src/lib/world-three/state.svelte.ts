/**
 * world-three/state — composables for derived scene values.
 *
 * Real-Earth scale (WGS84). Coordinates in metres, sphere at the actual
 * equatorial radius. This unlocks:
 *   - Real OSM building extrusion at correct geo positions
 *   - Real-world altitude semantics (cruise = 10 668 m for 35 kft)
 *   - (Archived) Takram Bruneton path — see docs/reference/takram-atmosphere-recipe.md
 *   - Future real heightfield terrain
 *
 * Three.js handles big numbers fine; the renderer uses logarithmic depth
 * (set on <Canvas>) so the 1 m → 10⁹ m near/far span works without
 * z-fighting.
 *
 * Conventions (matches three-globe / Three.js community standard):
 *   - World +Y = north pole
 *   - World +X = lat 0 / lon 0       (Greenwich on the equator)
 *   - World +Z = lat 0 / lon -90      (Galápagos/Americas side)
 *   - World -Z = lat 0 / lon +90      (India/East Asia side)
 *   - Sun direction is a unit vector in world space, drives directional
 *     light position scaled by SUN_DISTANCE_M.
 *
 * Why this asymmetric +Z = lon=-90 convention: Three.js's SphereGeometry
 * parameterises with `x = -R cos(phi) sin(theta), z = +R sin(phi) sin(theta)`,
 * which wraps a Plate Carrée equirect texture such that +Z displays
 * lon=-90. Negating Z in geoToCartesian below aligns world positions
 * with the texture wrapping — no texture transform or mesh rotation
 * required. Same convention three-globe and other open-source globes use.
 */


export const EARTH_RADIUS_M = 6378137;
export const FEET_PER_METER = 3.28084;
// Directional lights in Three.js are parallel — only the position
// VECTOR direction matters, not the magnitude. Keep these within the
// camera's far plane (1e9) so stars actually render in the scene.
export const SUN_DISTANCE_M = 1e8;         // 100 000 km — well past sky scale
export const STARS_RADIUS_M = 5e8;         // 500 000 km — inside far plane
export const SKY_SCALE_M  = 4.5e8;          // Three.js Sky.js — atmospheric dome
export const CLOUD_DECK_M = 8000;           // clouds at ~8 km altitude

// Sun direction + visibility + palette now live in world-three/sky.ts.
// Re-exports for back-compat with callers that import from state.svelte.ts.
export { computeSunDirection } from './sky';

type Vec3 = [number, number, number];

/**
 * Convert geographic (lat°, lon°, altitude metres) → world Cartesian.
 *
 * Convention matches three-globe and the broader Three.js community —
 * the Z component is NEGATED to align with the way Three.js's
 * `SphereGeometry` wraps Plate Carrée textures:
 *
 *   Three.js sphere equator (varying phi 0→2π):  -X → +Z → +X → -Z (CCW from +Y)
 *   Texture (Plate Carrée):                       lon=-180 → -90 → 0 → +90
 *
 * Without the Z negation, lon=+90 would land at +Z but the texture
 * shows lon=-90 there — a mirror across the X axis. With Z negated,
 * lon=+90 lands at -Z where the texture shows lon=+90. No texture
 * transform required.
 */
export function geoToCartesian(latDeg: number, lonDeg: number, altM: number): Vec3 {
	const r = EARTH_RADIUS_M + altM;
	const lat = (latDeg * Math.PI) / 180;
	const lon = (lonDeg * Math.PI) / 180;
	const cosLat = Math.cos(lat);
	return [r * cosLat * Math.cos(lon), r * Math.sin(lat), -r * cosLat * Math.sin(lon)];
}

