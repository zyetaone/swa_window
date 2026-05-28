<script lang="ts">
	/**
	 * CameraMirror — copies Cesium's camera into a Three.js PerspectiveCamera
	 * each frame.
	 *
	 * Mounted INSIDE a <Canvas> (it uses useTask) so it runs in Three.js's
	 * render loop, right before the frame is drawn. Reads `activeCesium`
	 * (the shared CesiumManager handle) and pulls the current camera
	 * position/direction/up vector + frustum FOV.
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
	import type { PerspectiveCamera } from 'three';
	import type { CesiumManager } from '$lib/world/compose';

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
		const viewer = mgr.getViewer();
		const cam = viewer.camera;
		const p = cam.positionWC;
		const d = cam.directionWC;
		const u = cam.upWC;

		// Position + up vectors: swap (cy ↔ cz, negate the original cy).
		camera.position.set(p.x, p.z, -p.y);
		camera.up.set(u.x, u.z, -u.y);

		// lookAt target = position + direction × LOOK_AHEAD_M, transformed.
		const tx = p.x + d.x * LOOK_AHEAD_M;
		const ty = p.z + d.z * LOOK_AHEAD_M;
		const tz = -(p.y + d.y * LOOK_AHEAD_M);
		camera.lookAt(tx, ty, tz);

		// FOV from Cesium's frustum. Cesium types this as a union of
		// Perspective/Off-center/Orthographic; the live viewer always uses
		// PerspectiveFrustum (CesiumManager doesn't switch), so a narrow
		// cast to read `fovy` is safe here.
		const fovy = (cam.frustum as { fovy: number }).fovy;
		if (Number.isFinite(fovy)) {
			const fovDeg = (fovy * 180) / Math.PI;
			if (Math.abs(camera.fov - fovDeg) > 0.01) {
				camera.fov = fovDeg;
				camera.updateProjectionMatrix();
			}
		}

		camera.updateMatrixWorld();
	});
</script>
