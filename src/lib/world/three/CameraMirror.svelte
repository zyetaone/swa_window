<script lang="ts">
	/**
	 * CameraMirror — copies Cesium's camera into a Three.js PerspectiveCamera
	 * each frame.
	 *
	 * Mounted INSIDE a <Canvas> (it uses useTask) so it runs in Three.js's
	 * render loop, right before the frame is drawn. Reads camera state via
	 * `CesiumManager.getCameraRead()` so it never reaches into Cesium's
	 * internal vector types — position/up/direction come back as plain
	 * `{x,y,z}` objects.
	 *
	 * Coordinate transform — Cesium and our Three.js world use different
	 * axis conventions:
	 *   Cesium ECEF:   X = Greenwich+equator, Y = 90°E+equator, Z = North pole
	 *   This project:  X = Greenwich+equator, Y = North pole,   Z = -90°E+equator
	 * So Three(x, y, z) = Cesium(cx, cz, -cy). Same transform applies to
	 * position, direction, and up — all three are vectors in the same frame.
	 * SSOT: cesiumToThreeVec in ./state.ts (unit-tested; do not re-inline).
	 *
	 * Without this swap, Three's clouds would render at the wrong points
	 * relative to where Cesium is showing terrain.
	 */
	import { useTask } from '@threlte/core';
	import { getCameraRead } from '$lib/world/camera';
	import { cesiumToThreeVec } from './state';
	import type { PerspectiveCamera } from 'three';

	let { camera }: { camera: PerspectiveCamera | undefined } = $props();

	// Distance ahead at which we compute the lookAt target. Anything > camera
	// near plane works; 200 km matches the value SkyState used previously and
	// keeps the lookAt direction numerically well-conditioned at WGS84 scale.
	const LOOK_AHEAD_M = 200_000;

	useTask(() => {
		if (!camera) return;
		const c = getCameraRead();
		if (!c) return;
		const p = c.position;
		const d = c.direction;
		const u = c.up;

		// Position + up vectors: swap (cy ↔ cz, negate the original cy).
		camera.position.set(...cesiumToThreeVec(p.x, p.y, p.z));
		camera.up.set(...cesiumToThreeVec(u.x, u.y, u.z));

		// lookAt target = position + direction × LOOK_AHEAD_M, transformed.
		// The swap is linear, so transforming the sum == summing the transforms.
		const [tx, ty, tz] = cesiumToThreeVec(
			p.x + d.x * LOOK_AHEAD_M,
			p.y + d.y * LOOK_AHEAD_M,
			p.z + d.z * LOOK_AHEAD_M,
		);
		camera.lookAt(tx, ty, tz);

		if (Number.isFinite(c.fovDeg) && Math.abs(camera.fov - c.fovDeg) > 0.01) {
			camera.fov = c.fovDeg;
			camera.updateProjectionMatrix();
		}

		camera.updateMatrixWorld();
	});
</script>
