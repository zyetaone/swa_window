/**
 * world/enu — local ENU (East-North-Up) tangent-plane anchor math.
 *
 * Many city-anchored Three-side assets (CityLightField, OsmRoads,
 * Clouds) construct the same 3-line basis matrix to position
 * a Group at a known (lat, lon, alt) on the WGS84 ellipsoid:
 *
 *   up    = normalize(geoToCartesian(lat, lon, alt))
 *   east  = normalize(cross(worldY, up))   // east.y is 0
 *   north = normalize(cross(up, east))
 *   matrix = makeBasis(east, up, -north) * translate(geoToCartesian)
 *
 * The negated-north basis column matches the Three.js sphere UV wrap that
 * geoToCartesian (in world/three/state.svelte.ts) already accounts for.
 * Once this matrix is set on a Group with `matrixAutoUpdate = false`, child
 * meshes positioned in local ENU coordinates (x=east, y=up, z=-north) land
 * at the correct world position on the ellipsoid surface.
 */
import { Matrix4, Vector3, type Object3D } from 'three';
import { geoToCartesian } from './three/state.svelte';

const _WORLD_Y = new Vector3(0, 1, 0);

/**
 * Pin a Three Group/Object to a precomputed ENU anchor matrix. The two steps
 * MUST run in this order: disabling `matrixAutoUpdate` first stops Three from
 * recomposing `matrix` from position/quaternion/scale each frame, so the basis
 * we copy in survives. Every city-anchored layer (CityLightField,
 * NeonLineLayer) shared this exact 2-line body inside its own `$effect` — the
 * `$effect` wrappers stay per-component (they own the reactive deps); only this
 * non-obvious imperative core is hoisted here.
 */
export function applyEnuAnchor(group: Object3D, matrix: Matrix4): void {
	group.matrixAutoUpdate = false;
	group.matrix.copy(matrix);
}

/**
 * Build the ENU anchor matrix at (lat°, lon°, alt m). Pure: every call
 * allocates a fresh Matrix4 + working Vector3s. Cheap (~5 allocations).
 */
export function enuAnchorMatrix(latDeg: number, lonDeg: number, altM: number): Matrix4 {
	const [x, y, z] = geoToCartesian(latDeg, lonDeg, altM);
	const up    = new Vector3(x, y, z).normalize();
	const east  = new Vector3().crossVectors(_WORLD_Y, up).normalize();
	const north = new Vector3().crossVectors(up, east).normalize();
	const matrix = new Matrix4().makeBasis(east, up, north.clone().negate());
	matrix.setPosition(x, y, z);
	return matrix;
}
