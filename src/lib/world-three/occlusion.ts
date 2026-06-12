/**
 * world-three/occlusion — Earth-limb occlusion for celestial sprites/meshes.
 *
 * Framework-free (no three.js / cesium imports): callers pass scalar
 * components so hot per-frame paths can feed Vector3 fields directly
 * without allocating.
 */
import { EARTH_RADIUS_M, OCCLUSION_SOFTNESS_M } from './state.svelte';

/**
 * Ray-sphere occlusion factor against the Earth (sphere at the world
 * origin, radius EARTH_RADIUS_M).
 *
 * Casts a ray from the camera position along the given unit direction
 * toward a celestial object at `objectDist` metres. Returns:
 *   - 1  → object fully visible (ray misses the Earth, or the Earth is
 *          behind the camera, or beyond the object)
 *   - 0  → object fully hidden behind the planet
 *   - (0..1) → soft fade across the Earth limb: the ray's closest
 *     approach to the Earth's centre, relative to the radius, ramped
 *     over OCCLUSION_SOFTNESS_M (0.5 exactly at the tangent). This is
 *     what makes the moon/Venus FADE rather than pop as they cross the
 *     horizon — celestial sprites render with depthTest:false, so this
 *     opacity factor is the only thing that can hide them.
 *
 * Contract:
 *   - (dirX, dirY, dirZ) must be a UNIT vector (callers normalise the
 *     camera→object offset themselves to avoid per-frame allocs).
 *   - (camX, camY, camZ) is the camera world position in metres.
 *   - `objectDist` is the camera→object distance in metres; an Earth
 *     intersection entering at or beyond it does not occlude.
 *   - Pure + allocation-free; safe to call every frame.
 *
 * Math: b = dot(cam, dir); disc = b² − (|cam|² − R²). No real roots →
 * miss. tExit = −b + √disc must be > 0 (sphere ahead of the camera —
 * keeps grazing / at-altitude cases a `tEntry > 0` gate would drop) and
 * tEntry = −b − √disc must be < objectDist (sphere in front of the
 * object). When occluding, fade by closestApproach = √max(0, |cam|² − b²)
 * versus the radius over the softness band.
 */
export function earthOcclusionFactor(
	camX: number,
	camY: number,
	camZ: number,
	dirX: number,
	dirY: number,
	dirZ: number,
	objectDist: number,
): number {
	const b = camX * dirX + camY * dirY + camZ * dirZ;
	const camLenSq = camX * camX + camY * camY + camZ * camZ;
	const disc = b * b - (camLenSq - EARTH_RADIUS_M * EARTH_RADIUS_M);
	if (disc < 0) return 1;
	const sq = Math.sqrt(disc);
	const tEntry = -b - sq;
	const tExit = -b + sq;
	if (tExit <= 0 || tEntry >= objectDist) return 1;
	const closestApproach = Math.sqrt(Math.max(0, camLenSq - b * b));
	const edgeDistance = closestApproach - EARTH_RADIUS_M;
	return Math.max(0, Math.min(1, 0.5 + edgeDistance / OCCLUSION_SOFTNESS_M));
}
