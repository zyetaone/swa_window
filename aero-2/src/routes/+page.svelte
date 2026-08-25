<script lang="ts">
	/**
	 * The window — declarative component architecture with Svelte 5 runes & Context DI.
	 *
	 * Layer composition:
	 *   MapStage      the world (WebGL canvas)   z 0
	 *   GlassLayer    reflections + vignette     z 10
	 *   PassengerHud  destination + telemetry    z 15
	 *   WindowFrame   the cabin bezel            z 20
	 *   CabinBlind    the pull-down shade        z 25
	 *   DebugReadout  dev only                   z 50
	 */
	import { dev } from '$app/env';
	import { createAeroWindow } from '#lib/sim/context.js';

	import MapStage from '#lib/stage/MapStage.svelte';
	import GroundLayers from '#lib/stage/GroundLayers.svelte';
	import AtmosphereSky from '#lib/stage/AtmosphereSky.svelte';
	import GlassLayer from '#lib/cabin/GlassLayer.svelte';
	import PassengerHud from '#lib/cabin/PassengerHud.svelte';
	import WindowFrame from '#lib/cabin/WindowFrame.svelte';
	import CabinBlind from '#lib/cabin/CabinBlind.svelte';
	import DebugReadout from '#lib/cabin/DebugReadout.svelte';

	import type { PageProps } from './$types';

	const { data }: PageProps = $props();
	const windowState = createAeroWindow(() => data);
</script>

<svelte:head><title>aero-2</title></svelte:head>

<main class="aero-window">
	<MapStage>
		<GroundLayers />
		<AtmosphereSky />
	</MapStage>

	<GlassLayer />
	<PassengerHud />
	<WindowFrame />
	<CabinBlind bind:closed={windowState.blindClosed} />

	{#if dev}
		<DebugReadout />
	{/if}
</main>

<style>
	.aero-window {
		position: fixed;
		inset: 0;
		background: #000;
		overflow: hidden;
		user-select: none;
	}
</style>
