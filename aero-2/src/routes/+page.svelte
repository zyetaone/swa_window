<script lang="ts">
	/**
	 * Declarative Window Architecture — composed directly in the route.
	 *
	 * Layer composition:
	 *   WorldStage          outside 3D WebGL world (terrain, satellite, sky)
	 *   CabinFrame          inside cabin window shell
	 *     GlassVignette     lens radial vignette
	 *     GlassReflection   glossy light reflection
	 *     WindowBezel       oval window bezel & depth shadow
	 */
	import { page } from '$app/state';
	import { readPaneConfig } from '#lib/config.js';
	import { createDisplay } from '#lib/display/display.svelte.js';
	import WorldStage from '#lib/display/WorldStage.svelte';
	import CabinFrame from '#lib/display/CabinFrame.svelte';
	import GlassVignette from '#lib/display/GlassVignette.svelte';
	import GlassReflection from '#lib/display/GlassReflection.svelte';
	import WindowBezel from '#lib/display/WindowBezel.svelte';

	createDisplay(readPaneConfig(page.url));
</script>

<svelte:head><title>aero-2</title></svelte:head>

<main class="aero-display">
	<WorldStage />

	<CabinFrame>
		<GlassVignette />
		<GlassReflection />
		<WindowBezel />
	</CabinFrame>
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
