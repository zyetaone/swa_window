<script lang="ts">
	/**
	 * Clouds — multi-shell parallax cloud system.
	 *
	 * Three transparent shells at different altitudes give a parallax
	 * sense of depth without paying the cost of full volumetric ray-
	 * marching. Each shell uses a CLONED copy of the cloud texture so
	 * their UV transforms (repeat/offset) don't trample each other —
	 * a Three.js Texture's repeat/offset live on the texture instance,
	 * not the material.
	 *
	 *   layer 0 (low,  ~4 km):  cumulus carpet — opaque, slow drift
	 *   layer 1 (mid,  ~8 km):  alto-stratus  — primary layer
	 *   layer 2 (high, ~16 km): cirrus wisps  — faint, fast, large scale
	 *
	 * Sun direction comes through MeshStandardMaterial's lighting model
	 * automatically — no custom shader.
	 *
	 * Next milestone (out of scope this turn): port to @takram/three-clouds
	 * for true volumetric rendering. The recipe is in
	 * docs/reference/takram-atmosphere-recipe.md.
	 */
	import { T, useTask } from '@threlte/core';
	import { useTexture } from '@threlte/extras';
	import { Mesh, Texture } from 'three';
	import { EARTH_RADIUS_M, CLOUD_DECK_M } from './state.svelte';

	let { density }: { density: number } = $props();

	const cloudsPromise = useTexture('/textures/earth/clouds.jpg');

	const LAYERS = [
		{ altM: CLOUD_DECK_M - 4000, scale: 1.4, opacityMul: 0.55, drift:  0.012, offsetU: 0.00 },
		{ altM: CLOUD_DECK_M,         scale: 1.0, opacityMul: 1.00, drift:  0.020, offsetU: 0.18 },
		{ altM: CLOUD_DECK_M + 8000,  scale: 0.7, opacityMul: 0.35, drift: -0.030, offsetU: 0.42 },
	];

	// $state.raw — bind:ref writes need to land, but we don't want
	// Three.js Mesh internals wrapped in a Proxy. The drift loop reads
	// each slot every frame via useTask without needing reactivity.
	let meshes: (Mesh | undefined)[] = $state.raw([undefined, undefined, undefined]);

	// Track cloned textures so we can dispose them when the component
	// unmounts (each clone allocates its own GPU upload). Without this,
	// each route revisit leaks three GPU textures.
	const clonedTextures: Texture[] = [];

	/** Clone a Texture so its UV transform can be set independently. */
	function cloneWithTransform(src: Texture, scale: number, offsetU: number): Texture {
		const t = src.clone();
		t.repeat.set(scale, scale);
		t.offset.set(offsetU, 0);
		t.needsUpdate = true;
		clonedTextures.push(t);
		return t;
	}

	useTask((delta) => {
		for (let i = 0; i < meshes.length; i++) {
			const m = meshes[i];
			if (m) m.rotation.y += delta * LAYERS[i].drift;
		}
	});

	$effect(() => () => {
		for (const t of clonedTextures) t.dispose();
		clonedTextures.length = 0;
	});
</script>

{#await cloudsPromise then cloudsMap}
	{#each LAYERS as L, i (i)}
		<T.Mesh bind:ref={meshes[i]}>
			<T.SphereGeometry args={[EARTH_RADIUS_M + L.altM, 96, 48]} />
			<T.MeshStandardMaterial
				alphaMap={cloneWithTransform(cloudsMap, L.scale, L.offsetU)}
				transparent
				opacity={Math.min(1, density * L.opacityMul)}
				depthWrite={false}
				roughness={0.95}
			/>
		</T.Mesh>
	{/each}
{/await}
