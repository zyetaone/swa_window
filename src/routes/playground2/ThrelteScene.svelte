<script lang="ts">
	/**
	 * ThrelteScene — pure-Threlte scene for cells 5-6 (no MapLibre).
	 *
	 * Camera sits bird's-eye at sceneState altitude, looking slightly down
	 * and rotated by heading. SkyDome always present; clouds + post-FX
	 * drive through a single EffectStack composer so the two never fight
	 * over `autoRender` (the bug that made cells 5/6 go dark earlier).
	 */
	import { Canvas, T } from '@threlte/core';
	import * as THREE from 'three';
	import SkyDome from './layers/SkyDome.svelte';
	import EffectStack from './layers/EffectStack.svelte';
	import { sceneState } from './lib/scene-state.svelte';

	let {
		showClouds,
		showPostFX,
	}: { showClouds: boolean; showPostFX: boolean } = $props();

	const DEG2RAD = Math.PI / 180;

	const camPos = $derived([0, sceneState.altitudeMeters, 0] as [number, number, number]);
	const camRot = $derived([
		-sceneState.pitchDeg * DEG2RAD,
		-sceneState.headingDeg * DEG2RAD,
		0,
	] as [number, number, number]);
</script>

<!-- AgX is applied by EffectStack when postfx is on; Canvas uses
     NoToneMapping as the fallback so plain SkyDome renders in linear
     (vivid blues). -->
<Canvas toneMapping={THREE.NoToneMapping}>
	<T.PerspectiveCamera
		makeDefault
		position={camPos}
		rotation={camRot}
		rotation.order={'YXZ'}
		fov={55}
		near={10}
		far={2e6}
	/>
	<T.AmbientLight intensity={0.35} />

	<SkyDome />

	<!-- One composer drives whichever passes are active. No autoRender
	     collision — EffectStack owns the render loop. -->
	<EffectStack clouds={showClouds} postfx={showPostFX} />
</Canvas>
