<script lang="ts">
	/**
	 * Scene — the Threlte scene graph for a single cell. Gated by the
	 * `layers` set so each cell only renders what it's responsible for.
	 *
	 * First commit: only sky support — just a placeholder gradient
	 * background so every cell renders SOMETHING while we wait for the
	 * takram atmosphere import to stabilize. Subsequent commits add
	 * one layer per file in ./layers/ and include them here.
	 */
	import { T } from '@threlte/core';
	import type { GridLayerId } from './lib/scene-state.svelte';
	import { sceneState } from './lib/scene-state.svelte';

	let { layers }: { layers: Set<GridLayerId> } = $props();

	// Sky colour placeholder until we wire takram/three-atmosphere.
	// Phase-driven so cells still change with the time-of-day slider.
	const skyColor = $derived.by(() => {
		const t = sceneState.timeOfDay;
		// crude day-arc: lerp between night navy / day blue / dusk red
		if (t < 5 || t > 22) return '#050a22';
		if (t < 7) return '#d8c4e0';
		if (t < 17) return '#4a90d9';
		if (t < 19) return '#e51d34';
		return '#1a1a3e';
	});
</script>

<T.PerspectiveCamera
	makeDefault
	position={[0, 0, 5]}
	fov={60}
/>

<T.AmbientLight intensity={0.3} />
<T.DirectionalLight position={[4, 6, 3]} intensity={1.0} />

{#if layers.has('sky')}
	<!-- Placeholder background sphere — replaced by takram atmosphere
	     in commit 2. Keeping a cheap gradient here so the grid shows
	     something non-black on first load. -->
	<T.Mesh>
		<T.SphereGeometry args={[100, 32, 16]} />
		<T.MeshBasicMaterial color={skyColor} side={1} />
	</T.Mesh>
{/if}

<!-- Future layers: terrain, water, buildings, clouds, post-fx.
     Each lands in a subsequent commit, guarded by layers.has(...). -->
