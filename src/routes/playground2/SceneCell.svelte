<script lang="ts">
	/**
	 * SceneCell — one tile in the 6-grid layer visualizer.
	 *
	 * Commit 2: MapLibre globe as the base layer for every cell. Later
	 * commits stack Three.js overlays (sky dome, sun/moon, clouds,
	 * post-FX) on top of this MapLibre canvas. For cells that don't
	 * yet have their "own" layer defined, they simply show the globe
	 * — visually identical until a later commit adds the distinguishing
	 * layer.
	 */
	import MapLibreCell from './MapLibreCell.svelte';
	import { GRID_LAYERS, layersFor } from './lib/scene-state.svelte';

	let { cellIdx }: { cellIdx: number } = $props();

	const info = $derived(GRID_LAYERS[cellIdx]);
	const activeLayers = $derived(layersFor(cellIdx));
</script>

<div class="cell">
	<!-- Layer 2 (terrain / satellite) — actually lives at every cell
	     because the MapLibre globe IS the terrain substrate. Layer 1
	     (sky dome) will compose over this in commit 4. -->
	<MapLibreCell />

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
