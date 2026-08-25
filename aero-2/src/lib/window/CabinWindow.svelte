<script lang="ts">
	import { globe, type GlobeHooks } from '#lib/cesium/attach.svelte.js';
	import { scene } from '#lib/window/scene.svelte.js';
	import { tileCache } from '#lib/cesium/tiles.svelte.js';
	import { gameLoop } from '#lib/window/game-loop.js';
	import { createAeroWindow } from '#lib/window/aero-window.svelte.js';
	import 'cesium/Build/Cesium/Widgets/widgets.css';

	const model = createAeroWindow();

	let globeReady = $state(false);

	const statusLabel = $derived.by(() => {
		if (!globeReady) return 'loading';
		if (tileCache.probing) return 'tiles…';
		if (scene.imageryMode === 'local') return 'offline';
		if (scene.imageryMode === 'ion') return 'ion';
		return 'no imagery';
	});

	/** The one place the engine adapter is wired to the scene. */
	const hooks = {
		token: import.meta.env.VITE_CESIUM_ION_TOKEN,
		open: (Cesium, viewer, token) => scene.open(Cesium, viewer, token),
		close: () => scene.close(),
		onReady: () => {
			globeReady = true;
			scene.sync(model.frame());
		},
	} satisfies GlobeHooks;

	$effect(() => {
		if (!scene.opened) return;
		return gameLoop.subscribe(() => {
			model.tick();
			scene.sync(model.frame());
		});
	});
</script>

<svelte:boundary>
	<div class="world" {@attach globe(hooks)}></div>

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
