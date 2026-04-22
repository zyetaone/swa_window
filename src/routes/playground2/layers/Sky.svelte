<script lang="ts">
	/**
	 * Sky — commit 2 layer. Three.js built-in Sky.js (Hosek-Wilkie
	 * atmospheric scattering, MIT). Drop-in physically-based sky dome
	 * with sun position + turbidity + Rayleigh / Mie controls.
	 *
	 * Chose Sky.js over @takram/three-atmosphere for this first pass
	 * because Sky.js is a single mesh with no precompute step; takram
	 * needs a ~second-long GPU texture precompute per cell (6 cells
	 * = 6× the cost). We'll swap to takram later if the volumetric
	 * clouds layer needs its shadow-interop wiring. For now, Sky.js
	 * gives visible, phase-appropriate sky in every cell immediately.
	 */
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import { Sky } from 'three/examples/jsm/objects/Sky.js';
	import { sceneState } from '../lib/scene-state.svelte';
	import { sunVectorForSky } from '../lib/sun.svelte';

	const sky = new Sky();
	sky.scale.setScalar(450000); // 450 km radius — big enough to feel infinite at 30k ft

	const uniforms = (sky.material as THREE.ShaderMaterial).uniforms;
	uniforms.turbidity.value = 6;         // atmospheric haziness; 6 = moderately clean
	uniforms.rayleigh.value = 2.2;        // blue scattering — higher = deeper blue midday
	uniforms.mieCoefficient.value = 0.004; // aerosol scattering amplitude
	uniforms.mieDirectionalG.value = 0.82; // scattering forward-bias; 0.8-0.85 = plausible

	// Sun direction live-updates from SSOT. The Sky shader uses
	// `sunPosition` as a direction from origin.
	$effect(() => {
		const v = sunVectorForSky(sceneState.timeOfDay, sceneState.lat);
		uniforms.sunPosition.value.copy(v);
	});
</script>

<T is={sky} />
