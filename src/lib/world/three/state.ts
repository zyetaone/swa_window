/**
 * world/three/state — composables for derived scene values.
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
// Soft Earth-limb fade band for celestial occlusion (moon/Venus fade vs pop).
export const CLOUD_DECK_M = 8000;           // clouds at ~8 km altitude

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
	// WGS84 ellipsoid (NOT a sphere) — Cesium places its globe + terrain +
	// imagery on the WGS84 ellipsoid and the camera is mirrored from Cesium's
	// exact ECEF frame, so Three geo-anchored content MUST use the same ellipsoid
	// or it mis-registers vertically by the sphere-vs-ellipsoid gap (~1.9 km at
	// mid-latitudes) — the root cause of "orphan lights" floating off the lit
	// ground. Axis convention unchanged (X=ecef_x, Y=ecef_z up, Z=−ecef_y); only
	// the radial distance becomes latitude-dependent via the prime-vertical
	// radius N. Pass altM = terrain elevation to land assets ON the draped ground.
	const e2 = 0.0066943799901413165; // WGS84 first eccentricity²
	const lat = (latDeg * Math.PI) / 180;
	const lon = (lonDeg * Math.PI) / 180;
	const sinLat = Math.sin(lat);
	const cosLat = Math.cos(lat);
	const N = EARTH_RADIUS_M / Math.sqrt(1 - e2 * sinLat * sinLat);
	const xy = (N + altM) * cosLat;
	return [xy * Math.cos(lon), (N * (1 - e2) + altM) * sinLat, -xy * Math.sin(lon)];
}

