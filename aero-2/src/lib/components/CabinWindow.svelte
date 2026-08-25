<script lang="ts">
	import { globe } from '#lib/render/attach.svelte.js';
	import { worldRuntime } from '#lib/render/runtime.svelte.js';
	import { tileCache } from '#lib/render/tiles.svelte.js';
	import { gameLoop } from '#lib/state/game-loop.js';
	import { createAeroWindow } from '#lib/state/aero-window.svelte.js';
	import 'cesium/Build/Cesium/Widgets/widgets.css';

	const model = createAeroWindow();

	let globeReady = $state(false);

	const statusLabel = $derived.by(() => {
		if (!globeReady) return 'loading';
		if (tileCache.probing) return 'tiles…';
		if (worldRuntime.imageryMode === 'local') return 'offline';
		if (worldRuntime.imageryMode === 'ion') return 'ion';
		return 'no imagery';
	});

	function onGlobeReady(): void {
		globeReady = true;
		worldRuntime.sync(model.frame());
	}

	$effect(() => {
		if (!worldRuntime.opened) return;
		return gameLoop.subscribe(() => {
			model.tick();
			worldRuntime.sync(model.frame());
		});
	});
</script>

<svelte:boundary>
	<div class="world" {@attach globe(import.meta.env.VITE_CESIUM_ION_TOKEN, onGlobeReady)}></div>

	{#if import.meta.env.DEV}
		<p class="status" aria-live="polite">{statusLabel}</p>
	{/if}

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
	.status {
		position: fixed;
		left: 0.75rem;
		bottom: 0.75rem;
		margin: 0;
		padding: 0.25rem 0.5rem;
		font: 11px/1.4 ui-monospace, monospace;
		color: rgb(255 255 255 / 0.55);
		pointer-events: none;
	}
</style>
