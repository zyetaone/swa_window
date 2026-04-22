<script lang="ts">
	/**
	 * /playground2 — the layer-by-layer visualizer.
	 *
	 * Six cells in a 2-column × 3-row grid, each rendering a
	 * cumulative set of layers via SceneCell + Scene. Every cell
	 * shares state via lib/scene-state.svelte.ts, so moving the
	 * time-of-day slider (bottom bar) updates all six in sync.
	 *
	 * Philosophy: the whole stack is Threlte / Three.js + open-source
	 * libs (takram atmosphere + clouds, pmndrs postprocessing,
	 * Terrarium DEM, Sentinel-2 imagery, OSM buildings). No paid
	 * tokens anywhere. Each layer lands in its own commit so you can
	 * see the build up step by step.
	 */
	import SceneCell from './SceneCell.svelte';
	import { sceneState, GRID_LAYERS } from './lib/scene-state.svelte';
</script>

<main class="pg2">
	<header class="banner">
		<h1>Playground 2 — Layer Visualizer</h1>
		<p>Threlte + takram atmosphere + volumetric clouds + open-source tiles.</p>
	</header>

	<div class="grid">
		{#each GRID_LAYERS as _layer, idx}
			<SceneCell cellIdx={idx} />
		{/each}
	</div>

	<footer class="dock">
		<label class="row">
			<span class="label">time of day</span>
			<input
				type="range"
				min="0"
				max="24"
				step="0.05"
				bind:value={sceneState.timeOfDay}
			/>
			<span class="value">{sceneState.timeOfDay.toFixed(1)}h</span>
		</label>
		<label class="row">
			<span class="label">altitude</span>
			<input
				type="range"
				min="500"
				max="40000"
				step="100"
				bind:value={sceneState.altitudeMeters}
			/>
			<span class="value">{(sceneState.altitudeMeters / 1000).toFixed(1)}k m</span>
		</label>
		<label class="row">
			<span class="label">heading</span>
			<input
				type="range"
				min="0"
				max="360"
				step="1"
				bind:value={sceneState.headingDeg}
			/>
			<span class="value">{sceneState.headingDeg}°</span>
		</label>
	</footer>
</main>

<style>
	.pg2 {
		position: fixed;
		inset: 0;
		background: #04060d;
		color: #e8eef7;
		font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
		display: grid;
		grid-template-rows: auto 1fr auto;
	}

	.banner {
		padding: 10px 16px 6px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		background: rgba(10, 14, 26, 0.8);
	}

	.banner h1 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.banner p {
		margin: 2px 0 0;
		font-size: 11px;
		color: rgba(232, 238, 247, 0.55);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr 1fr;
		gap: 1px;
		background: rgba(255, 255, 255, 0.04);
		overflow: hidden;
	}

	.dock {
		padding: 10px 16px;
		display: flex;
		flex-wrap: wrap;
		gap: 16px 24px;
		align-items: center;
		background: rgba(10, 14, 26, 0.9);
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
	}

	.label {
		color: rgba(232, 238, 247, 0.6);
		min-width: 80px;
	}

	.value {
		color: rgba(232, 238, 247, 0.9);
		min-width: 70px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	input[type='range'] {
		width: 180px;
		accent-color: #4a90d9;
	}
</style>
