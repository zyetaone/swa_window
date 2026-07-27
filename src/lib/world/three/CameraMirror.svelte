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
	 *
	 * Without this swap, Three's clouds would render at the wrong points
	 * relative to where Cesium is showing terrain.
	 */
	import { useTask } from '@threlte/core';
	import { activeCesium } from '$lib/world/active.svelte';
	import type { CesiumManager } from '$lib/world/compose';
	import type { PerspectiveCamera } from 'three';

	let { camera }: { camera: PerspectiveCamera | undefined } = $props();

	// Distance ahead at which we compute the lookAt target. Anything > camera
	// near plane works; 200 km matches the value SkyState used previously and
	// keeps the lookAt direction numerically well-conditioned at WGS84 scale.
	const LOOK_AHEAD_M = 200_000;

	// Cache the manager via $effect so useTask doesn't establish a reactive
	// read inside its 60 Hz callback. Re-runs only when the manager mounts /
	// unmounts (page navigation, HMR), which is the only thing that should
	// invalidate the cached viewer.
	let mgr: CesiumManager | null = $state.raw(null);
	$effect(() => { mgr = activeCesium.manager; });

	useTask(() => {
		if (!mgr || !camera) return;
		const c = mgr.getCameraRead();
		const p = c.position;
		const d = c.direction;
		const u = c.up;

		// Position + up vectors: swap (cy ↔ cz, negate the original cy).
		camera.position.set(p.x, p.z, -p.y);
		camera.up.set(u.x, u.z, -u.y);

		// lookAt target = position + direction × LOOK_AHEAD_M, transformed.
		const tx = p.x + d.x * LOOK_AHEAD_M;
		const ty = p.z + d.z * LOOK_AHEAD_M;
		const tz = -(p.y + d.y * LOOK_AHEAD_M);
		camera.lookAt(tx, ty, tz);

		if (Number.isFinite(c.fovDeg) && Math.abs(camera.fov - c.fovDeg) > 0.01) {
			camera.fov = c.fovDeg;
			camera.updateProjectionMatrix();
		}

		camera.updateMatrixWorld();
	});
</script>
