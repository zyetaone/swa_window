/**
 * world/three/occlusion — Earth-limb occlusion for celestial sprites/meshes.
 *
 * Framework-free (no three.js / cesium imports): callers pass scalar
 * components so hot per-frame paths can feed Vector3 fields directly
 * without allocating.
 */
import { EARTH_RADIUS_M, OCCLUSION_FADE_RAD } from './state.svelte';

/**
 * Earth-limb occlusion factor for a celestial body, 0 (hidden) … 1 (visible).
 *
 * This function is not an optimisation — it is the ONLY Earth occluder that
 * exists. The Three overlay is a transparent canvas composited on top of the
 * Cesium canvas, so Cesium's terrain never enters Three's depth buffer and no
 * depthTest setting can make ground hide the moon. Everything the sky knows
 * about being blocked by the planet, it knows from here.
 *
 * Measured as ANGLE above the horizon, not as a ray's closest approach in
 * metres. The old ray-sphere form faded on closest-approach-versus-radius,
 * which cannot work: that ramp only runs on rays that actually HIT the Earth,
 * where the closest approach is by definition inside the radius. So the fade
 * band sat entirely below the horizon and the visible side got no ramp at all
 * — the factor stepped straight from 1 to 0.5 at the tangent (with the old
 * `0.5 +` bias) and the moon appeared to rest on the horizon line. Expressing
 * the band in radians puts it where it belongs, above the limb, and makes it
 * altitude-independent: metres of closest approach are bounded by the camera's
 * own altitude, so at 10 km cruise no metre-denominated band wider than 10 km
 * could ever be traversed.
 *
 * Horizon geometry: from |cam| = L, the tangent ray makes angle asin(R/L) with
 * the direction to the Earth's centre, so the horizon sits at zenith angle
 * acos(-sqrt(1 - (R/L)^2)) — just past 90° by the horizon dip.
 *
 * ⚠ Known limitation: a smooth sphere of radius EARTH_RADIUS_M (sea level).
 * Terrain is invisible to it, so a body can still show through a ridge that
 * is geometrically above the horizon line. That needs a terrain-height sample
 * along the ray; deferred, since the sphere covers the case that actually
 * reads as broken — a low moon over open ground.
 *
 * Contract:
 *   - (dirX, dirY, dirZ) must be a UNIT vector (callers normalise the
 *     camera→object offset themselves to avoid per-frame allocs).
 *   - (camX, camY, camZ) is the camera world position in metres.
 *   - Pure + allocation-free; safe to call every frame.
 */
export function earthOcclusionFactor(
	camX: number,
	camY: number,
	camZ: number,
	dirX: number,
	dirY: number,
	dirZ: number,
): number {
	const camLenSq = camX * camX + camY * camY + camZ * camZ;
	const camLen = Math.sqrt(camLenSq);
	if (camLen <= 0) return 1;

	// Zenith angle of the body: 0 = straight overhead, pi = straight down.
	const cosZenith = (camX * dirX + camY * dirY + camZ * dirZ) / camLen;
	if (cosZenith >= 0) return 1; // at or above local horizontal — always visible

	// Zenith angle of the horizon itself, always slightly past 90 deg.
	const sinDip = Math.min(1, EARTH_RADIUS_M / camLen);
	const cosHorizon = -Math.sqrt(Math.max(0, 1 - sinDip * sinDip));

	const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
	const zenithHorizon = Math.acos(Math.max(-1, Math.min(1, cosHorizon)));

	// Positive above the horizon, negative below.
	const elevationAboveHorizon = zenithHorizon - zenith;
	return Math.max(0, Math.min(1, elevationAboveHorizon / OCCLUSION_FADE_RAD));
}
