<script lang="ts">
	/**
	 * SceneCell — one tile in the 6-grid layer visualizer.
	 *
	 * Hosts a Threlte <Canvas> with a cumulative set of layers. The
	 * first cell shows only `sky`; the second adds `terrain`; the
	 * sixth composites everything plus post-FX. Shared SSOT
	 * (scene-state.svelte.ts) keeps all cells in lockstep for apples-
	 * to-apples comparison.
	 *
	 * Each layer is a small Svelte component mounted inside the Canvas
	 * — we add them one at a time in subsequent commits.
	 */
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import { GRID_LAYERS, layersFor } from './lib/scene-state.svelte';

	let { cellIdx }: { cellIdx: number } = $props();

	const info = $derived(GRID_LAYERS[cellIdx]);
	const activeLayers = $derived(layersFor(cellIdx));
</script>

<div class="cell">
	<Canvas>
		<Scene layers={activeLayers} />
	</Canvas>
	<div class="cell-label" aria-hidden="true">
		<span class="cell-title">{info.label}</span>
		<span class="cell-caption">{info.caption}</span>
	</div>
</div>

<style>
	.cell {
		position: relative;
		width: 100%;
		height: 100%;
		background: #0a0e1a;
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.05);
	}

	.cell-label {
		position: absolute;
		left: 10px;
		bottom: 10px;
		padding: 6px 10px;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(8px);
		border-radius: 6px;
		color: #fff;
		font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
		font-size: 11px;
		display: flex;
		flex-direction: column;
		gap: 1px;
		pointer-events: none;
	}

	.cell-title {
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	.cell-caption {
		color: rgba(255, 255, 255, 0.65);
		font-size: 10px;
	}
</style>
