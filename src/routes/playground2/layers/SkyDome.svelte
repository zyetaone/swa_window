<script lang="ts">
	/**
	 * SkyDome — commit 3 of the /playground2 layer visualizer.
	 *
	 * Three.js Sky.js (Hosek-Wilkie analytical scattering) mounted at a
	 * huge scale so it wraps the whole scene. Sun position is driven by
	 * sceneState.timeOfDay + sceneState.lat via sunVectorForSky so the
	 * dome phases with the rest of the grid.
	 *
	 * Composition strategy
	 * --------------------
	 * This component is meant to sit inside a Threlte <Canvas> whose
	 * WebGL canvas has a transparent clear colour. That lets the
	 * MapLibre globe (painted underneath in SceneCell) show through
	 * wherever the sky dome is thin — i.e. below the horizon or when
	 * the sun is set and scattering drops. We don't do any alpha
	 * blending tricks here — the Sky shader writes opaque colour
	 * everywhere; the "show-through" happens outside the dome.
	 *
	 * Threlte gotcha
	 * --------------
	 * Threlte v8 renders on-demand by default: if no reactive Three.js
	 * property changes, the scheduler skips the frame. We update Sky's
	 * sunPosition uniform imperatively (it's a Vector3 mutation, not a
	 * reactive prop), so after each update we call `invalidate()` from
	 * `useThrelte` to tell Threlte to redraw.
	 */

	import { T, useThrelte } from '@threlte/core';
	import { Sky } from 'three/addons/objects/Sky.js';
	import { sceneState } from '../lib/scene-state.svelte';
	import { sunVectorForSky } from '../lib/sun.svelte';

	// Module-level instance — we want exactly one Sky mesh per mount,
	// and we never want the constructor to run inside a reactive block.
	const sky = new Sky();
	sky.scale.setScalar(450_000);

	// Baseline scattering uniforms. Values picked to match the "clear
	// but slightly hazy" look used across the production window — a
	// clean azure at zenith with a visible horizon glow.
	{
		const u = sky.material.uniforms;
		u.turbidity.value = 2.2;
		u.rayleigh.value = 3.0;
		u.mieCoefficient.value = 0.004;
		u.mieDirectionalG.value = 0.82;
	}

	const { invalidate } = useThrelte();

	// React to sun-driver changes: recompute the sun unit vector and
	// poke Threlte so the on-demand renderer actually redraws.
	$effect(() => {
		const sun = sunVectorForSky(sceneState.timeOfDay, sceneState.lat);
		sky.material.uniforms.sunPosition.value.copy(sun);
		invalidate();
	});
</script>

<T is={sky} />
