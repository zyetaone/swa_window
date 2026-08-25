<script lang="ts">
	/**
	 * The window display — declarative component architecture with Svelte 5 runes & Context DI.
	 *
	 * Layer composition:
	 *   WorldStage    the outside world (WebGL canvas, DEM terrain, satellite imagery, sky)
	 *   CabinFrame    the inside cabin window (oval bezel, depth shadow, glass reflection & vignette)
	 */
	import { page } from '$app/state';
	import { readPaneConfig } from '#lib/config.svelte.js';
	import { createDisplay } from '#lib/display/display.svelte.js';
	import WorldStage from '#lib/display/WorldStage.svelte';
	import CabinFrame from '#lib/display/CabinFrame.svelte';

	createDisplay(readPaneConfig(page.url));
</script>

<svelte:head><title>aero-2</title></svelte:head>

<main class="aero-display">
	<WorldStage />
	<CabinFrame />
</main>

<style>
	.aero-display {
		position: fixed;
		inset: 0;
		background: #000;
		overflow: hidden;
		user-select: none;
	}
</style>
