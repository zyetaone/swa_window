<script lang="ts">
	/**
	 * ThrelteScene — pure-Threlte scene for cells 5-6 (no MapLibre).
	 *
	 * Camera placed at ECEF (Earth-Centered Earth-Fixed) coordinates so
	 * takram's Bruneton atmosphere + CloudsEffect read the world the way
	 * they expect: Earth at origin with radius ~6378 km, camera floating
	 * ~altitudeMeters above the surface at the user's lat/lon.
	 *
	 * Why we dropped SkyDome from this scene:
	 *   Three.js Sky.js is a mesh scaled to 450 km centered at origin.
	 *   In ECEF mode the origin is Earth's center, so Sky.js is BURIED
	 *   inside the Earth — invisible from any above-surface camera. The
	 *   takram AerialPerspective already renders physically-based sky
	 *   via scattering (much better than Sky.js anyway), so we just
	 *   skip Sky.js here and let EffectStack's aerial pass own the sky.
	 *
	 * Camera orientation: constructed via Matrix4.lookAt(pos, target,
	 * up). The target is along the horizon in `heading` direction,
	 * tilted down by `pitch`. That's a cleaner primitive than chaining
	 * axis rotations around the ENU frame.
	 */

	import { Canvas, T } from '@threlte/core';
	import * as THREE from 'three';
	import { Geodetic, Ellipsoid } from '@takram/three-geospatial';
	import EffectStack from './layers/EffectStack.svelte';
	import { sceneState } from './lib/scene-state.svelte';

	let {
		showClouds,
		showPostFX,
	}: { showClouds: boolean; showPostFX: boolean } = $props();

	const DEG2RAD = Math.PI / 180;

	// Reused scratch objects so reactivity doesn't allocate each tick.
	const geo = new Geodetic();
	const camPos = new THREE.Vector3();
	const enuFrame = new THREE.Matrix4();
	const east = new THREE.Vector3();
	const north = new THREE.Vector3();
	const up = new THREE.Vector3();
	const forward = new THREE.Vector3();
	const target = new THREE.Vector3();
	const lookMat = new THREE.Matrix4();
	const camQuat = new THREE.Quaternion();
	const tempQuat = new THREE.Quaternion();

	const cameraTransform = $derived.by(() => {
		const lonRad = sceneState.lon * DEG2RAD;
		const latRad = sceneState.lat * DEG2RAD;
		const headingRad = sceneState.headingDeg * DEG2RAD;
		const pitchRad = sceneState.pitchDeg * DEG2RAD;

		geo.set(lonRad, latRad, sceneState.altitudeMeters);
		geo.toECEF(camPos);

		// ENU frame at camera's ground projection — columns are (E, N, U).
		Ellipsoid.WGS84.getEastNorthUpFrame(camPos, enuFrame);
		east.setFromMatrixColumn(enuFrame, 0);
		north.setFromMatrixColumn(enuFrame, 1);
		up.setFromMatrixColumn(enuFrame, 2);

		// Forward = north rotated around up by heading (clockwise from north).
		forward.copy(north);
		tempQuat.setFromAxisAngle(up, -headingRad);
		forward.applyQuaternion(tempQuat);

		// Rotate the right-hand axis by the same heading, then tilt forward
		// downward around that axis by pitchDeg.
		const rotatedEast = east.clone().applyQuaternion(tempQuat);
		tempQuat.setFromAxisAngle(rotatedEast, -pitchRad);
		forward.applyQuaternion(tempQuat).normalize();

		// Target a long way ahead so Matrix4.lookAt's far-target math is stable.
		target.copy(camPos).addScaledVector(forward, 1e7);

		lookMat.lookAt(camPos, target, up);
		camQuat.setFromRotationMatrix(lookMat);

		return {
			position: [camPos.x, camPos.y, camPos.z] as [number, number, number],
			quaternion: [camQuat.x, camQuat.y, camQuat.z, camQuat.w] as [
				number,
				number,
				number,
				number,
			],
		};
	});
</script>

<!-- AgX applied by EffectStack when postfx is on; otherwise linear. -->
<Canvas toneMapping={THREE.NoToneMapping}>
	<!-- ECEF camera. Far plane must span Earth's radius + atmosphere
	     (1e8 ≈ 100,000 km is plenty). Near plane held at 10 m for now. -->
	<T.PerspectiveCamera
		makeDefault
		position={cameraTransform.position}
		quaternion={cameraTransform.quaternion}
		fov={55}
		near={10}
		far={1e8}
	/>
	<T.AmbientLight intensity={0.35} />

	<!-- SkyDome intentionally omitted here: in ECEF it would be a 450-km
	     sphere buried inside the Earth at origin. takram's
	     AerialPerspective (inside EffectStack) is the physically-correct
	     sky for this coordinate system. -->
	<EffectStack clouds={showClouds} postfx={showPostFX} />
</Canvas>
