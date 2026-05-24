<script lang="ts">
	/**
	 * Sky — Three.js's analytical Hosek-Wilkie sky dome (from /addons).
	 *
	 * Replaces the hand-rolled Fresnel atmosphere with a proper physically-
	 * based sky shader. Same scattering math as the takram precomputed
	 * Bruneton path, just analytical instead of LUT-based — no asset
	 * loading, no real-Earth-coords prerequisite, scale-agnostic.
	 *
	 * world-three is the current artistic three.js path (WGS84 scale).
	 * The Takram Bruneton/atmosphere stack was archived (see docs/reference/takram-atmosphere-recipe.md).
	 * This analytical Hosek-Wilkie Sky + simple materials is the maintained baseline for the lab.
	 *
	 * Threlte idiom: instantiate the Three.js object ONCE in script init,
	 * mount via `<T is={sky}>`. Uniform updates flow through reactive
	 * `$effect`. No allocations per frame.
	 */
	import { T } from '@threlte/core';
	import { Sky } from 'three/addons/objects/Sky.js';
	import { Vector3 } from 'three';
	import { SKY_SCALE_M } from './state.svelte';

	let { sunDirection }: { sunDirection: [number, number, number] } = $props();

	const sky = new Sky();
	sky.scale.setScalar(SKY_SCALE_M);
	// Calm Hosek-Wilkie defaults tuned toward photographic dusk.
	sky.material.uniforms.turbidity.value        = 2.5;
	sky.material.uniforms.rayleigh.value         = 1.2;
	sky.material.uniforms.mieCoefficient.value   = 0.004;
	sky.material.uniforms.mieDirectionalG.value  = 0.82;

	const sunVec = new Vector3();
	$effect(() => {
		sunVec.set(sunDirection[0], sunDirection[1], sunDirection[2]);
		sky.material.uniforms.sunPosition.value.copy(sunVec);
	});
</script>

<T is={sky} />
