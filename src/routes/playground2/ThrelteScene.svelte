<script lang="ts">
	/**
	 * ThrelteScene — pure-Threlte scene for cells 5-6.
	 *
	 * No MapLibre. Full Three.js scene built from:
	 *   - SkyDome       (Three.js Sky.js, Hosek-Wilkie atmospheric scattering)
	 *   - VolumetricClouds (CloudsEffect + AerialPerspective, @takram)
	 *   - PostFX        (Bloom + LensFlare + Dithering, pmndrs + takram)
	 *
	 * Camera is bird's-eye, positioned at sceneState altitude, looking
	 * slightly down and rotated by headingDeg. Matches the "airplane window"
	 * vantage of the hybrid cells.
	 */
	import { Canvas } from '@threlte/core';
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import SkyDome from './layers/SkyDome.svelte';
	import VolumetricClouds from './layers/VolumetricClouds.svelte';
	import PostFX from './layers/PostFX.svelte';
	import { sceneState } from './lib/scene-state.svelte';

	let { showClouds, showPostFX }: { showClouds: boolean; showPostFX: boolean } = $props();

	const DEG2RAD = Math.PI / 180;

	// Camera: bird's-eye at altitudeMeters, pitch + heading from sceneState.
	const camPos = $derived([0, sceneState.altitudeMeters, 0] as [number, number, number]);
	const camRot = $derived([
		-sceneState.pitchDeg * DEG2RAD,
		-sceneState.headingDeg * DEG2RAD,
		0,
	] as [number, number, number]);
</script>

<!-- Threlte canvas: transparent so the page background (#04060d) shows through.
     No MapLibre underneath — this IS the scene. -->
<Canvas toneMapping={THREE.AgXToneMapping}>
	<!-- Camera -->
	<T.PerspectiveCamera
		makeDefault
		position={camPos}
		rotation={camRot}
		rotation.order={'YXZ'}
		fov={55}
		near={10}
		far={2e6}
	/>

	<!-- Ambient so terrain/buildings aren't pitch-black before sun loads -->
	<T.AmbientLight intensity={0.35} />

	<!-- Sky dome — always present in pure-Threlte cells -->
	<SkyDome />

	<!-- Volumetric clouds — async init, skipRendering until LUTs ready -->
	{#if showClouds}
		<VolumetricClouds />
	{/if}

	<!-- Post-processing — bloom + lens flare + dithering + AgX tone -->
	{#if showPostFX}
		<PostFX />
	{/if}
</Canvas>