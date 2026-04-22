<script lang="ts">
	/**
	 * SceneCell — one tile in the 6-grid layer visualizer.
	 *
	 * Composes the full multiplane stack per cell, gated by activeLayers.
	 * Each cell is a self-contained rendering pipeline; the shared SSOT
	 * (scene-state.svelte.ts) keeps the 6 cells in lockstep so sliding
	 * time-of-day updates every cell at once.
	 *
	 * Stacking order (bottom → top):
	 *   1. MapLibreCell        — globe + Sentinel-2 satellite + (opt.)
	 *                            OSM building extrusions
	 *   2. WaterOverlay         — reads MapLibre canvas, chroma-keys water,
	 *                             paints animated normals (transparent DOM
	 *                             sibling over MapLibre, below Three.js)
	 *   3. Threlte <Canvas>     — SkyDome + VolumetricClouds + PostFX
	 *                             (alpha so MapLibre + water show through
	 *                             below the horizon)
	 */
	import { Canvas } from '@threlte/core';
	import MapLibreCell from './MapLibreCell.svelte';
	import WaterOverlay from './layers/WaterOverlay.svelte';
	import SkyDome from './layers/SkyDome.svelte';
	import VolumetricClouds from './layers/VolumetricClouds.svelte';
	import PostFX from './layers/PostFX.svelte';
	import TransparentClear from './layers/TransparentClear.svelte';
	import ThrelteScene from './ThrelteScene.svelte';
	import { GRID_LAYERS, layersFor } from './lib/scene-state.svelte';

	let { cellIdx }: { cellIdx: number } = $props();

	const info = $derived(GRID_LAYERS[cellIdx]);
	const activeLayers = $derived(layersFor(cellIdx));

	// Pure-Threlte cells: cells 5 and 6 (0-indexed: 4 and 5).
	// These skip MapLibre entirely and render via ThrelteScene.
	const IS_THRELTE = $derived(cellIdx >= 4);

	// The MapLibre canvas, forwarded up from MapLibreCell via $bindable.
	// WaterOverlay needs this to chroma-key against the live globe pixels.
	let mapCanvas = $state<HTMLCanvasElement | undefined>(undefined);
</script>

<div class="cell">
	{#if IS_THRELTE}
		<!-- Cell 5: SkyDome + VolumetricClouds
		     Cell 6: SkyDome + VolumetricClouds + PostFX -->
		<ThrelteScene
			showClouds={true}
			showPostFX={cellIdx === 5}
		/>
	{:else}
		<!-- Cells 1-4: MapLibre globe + optional overlay layers -->
		<MapLibreCell
			bind:mapCanvas
			showBuildings={activeLayers.has('buildings')}
		/>

		{#if activeLayers.has('water') && mapCanvas}
			<WaterOverlay {mapCanvas} />
		{/if}

		<div class="three-overlay">
			<Canvas>
				<TransparentClear />
				{#if activeLayers.has('sky')}
					<SkyDome />
				{/if}
				{#if activeLayers.has('clouds')}
					<VolumetricClouds />
				{/if}
				{#if activeLayers.has('postfx')}
					<PostFX />
				{/if}
			</Canvas>
		</div>
	{/if}

	<div class="cell-label" aria-hidden="true">
		<span class="cell-title">{info.label}</span>
		<span class="cell-caption">{info.caption}</span>
		<span class="cell-layers">
			{#each activeLayers as id}<span class="layer-chip">{id}</span>{/each}
		</span>
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

	.three-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.three-overlay :global(canvas) {
		background: transparent;
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
		gap: 3px;
		pointer-events: none;
		z-index: 10;
	}

	.cell-title {
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	.cell-caption {
		color: rgba(255, 255, 255, 0.65);
		font-size: 10px;
	}

	.cell-layers {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		margin-top: 2px;
	}

	.layer-chip {
		background: rgba(74, 144, 217, 0.25);
		border: 1px solid rgba(74, 144, 217, 0.5);
		padding: 1px 6px;
		border-radius: 3px;
		font-size: 9px;
		color: #bad4f2;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
</style>
