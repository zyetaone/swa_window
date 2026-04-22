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
	import { pg, getSunDirection } from '../lib/playground-state.svelte';

	let { cameraPos }: { cameraPos?: [number, number, number] } = $props();

	// Module-level instance — we want exactly one Sky mesh per mount,
	// and we never want the constructor to run inside a reactive block.
	const sky = new Sky();
	sky.scale.setScalar(450_000);

	// Above-horizon clipping. Sky.js is a full 360° dome — it paints the
	// entire viewport, including the lower hemisphere, which would occlude
	// the MapLibre globe composited underneath the Canvas. We inject a
	// `discard` in the fragment shader for any pixel whose view direction
	// points below the horizon. With the Canvas cleared to alpha 0, those
	// pixels stay transparent and the globe beneath shows through.
	//
	// `direction` is already computed inside Sky.js's main() as:
	//   vec3 direction = normalize( vWorldPosition - cameraPosition );
	// We inject the discard right after that line.
	sky.material.onBeforeCompile = (shader) => {
		shader.fragmentShader = shader.fragmentShader.replace(
			'vec3 direction = normalize( vWorldPosition - cameraPosition );',
			`vec3 direction = normalize( vWorldPosition - cameraPosition );
			 if (direction.y < -0.01) discard;`,
		);
	};
	// Let Sky render behind everything — depthTest off so it never blocks
	// later layers, and we manually put it first via renderOrder.
	sky.material.transparent = true;
	sky.material.depthWrite = false;
	sky.renderOrder = -100;

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
		void pg.timeOfDay;
		const sun = getSunDirection();
		sky.material.uniforms.sunPosition.value.copy(sun);
		invalidate();
	});
</script>

<T is={sky} position={cameraPos ?? [0, 0, 0]} />
