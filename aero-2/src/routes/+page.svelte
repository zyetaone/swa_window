<script lang="ts">
	import { globe, syncGlobe } from '#lib/world/globe.js';
	import { gameLoop } from '#lib/game-loop.js';
	import { createAeroWindow } from '#lib/model/aero-window.js';
	import 'cesium/Build/Cesium/Widgets/widgets.css';

	const model = createAeroWindow();

	$effect(() =>
		gameLoop.subscribe((dt) => {
			model.tick(dt);
			syncGlobe(model.frame());
		}),
	);
</script>

<svelte:boundary>
	<div class="world" {@attach globe(import.meta.env.VITE_CESIUM_ION_TOKEN)}></div>

	{#snippet pending()}
		<div class="world placeholder"></div>
	{/snippet}

	{#snippet failed()}
		<div class="world placeholder"></div>
	{/snippet}
</svelte:boundary>

<style>
	.world {
		position: fixed;
		inset: 0;
	}
	.placeholder {
		background: linear-gradient(#243447, #4a5b70);
	}
</style>
