<script lang="ts">
	import { globe } from '#lib/world/globe.js';
	import 'cesium/Build/Cesium/Widgets/widgets.css';
</script>

<svelte:boundary>
	<div class="world" {@attach globe(import.meta.env.VITE_CESIUM_ION_TOKEN)}></div>

	{#snippet pending()}
		<div class="world placeholder"></div>
	{/snippet}

	{#snippet failed()}
		<!-- Never break the fiction: a failure renders an overcast window,
		     never an error surface the audience can read. -->
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
