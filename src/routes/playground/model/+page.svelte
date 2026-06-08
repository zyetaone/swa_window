<script lang="ts">
	/**
	 * /playground/model — GLB/GLTF MODEL INSPECTOR.
	 *
	 * A standalone Threlte viewer for inspecting 3D models — currently the
	 * Southwest 737 (Sketchfab, CC-BY-4.0). Orbit/zoom/pan, toggle wireframe,
	 * read mesh/triangle stats, and CLICK meshes to select → isolate/hide so
	 * the wing can be found in the 500-mesh graph and its names copied out for
	 * a Blender extraction (scopes Wing.svelte's real geometry, task #124).
	 */
	import { Canvas } from '@threlte/core';
	import ModelView, { type ModelStats, type InspectorController } from './ModelView.svelte';

	let wireframe = $state(false);
	let stats = $state<ModelStats | null>(null);
	const controller = $state<InspectorController>({ selection: [] });

	let copied = $state(false);
	async function copyNames() {
		const names = controller.selection.map((s) => s.name).join('\n');
		if (!names) return;
		try {
			await navigator.clipboard.writeText(names);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard blocked — fall back to console so the names are still
			// retrievable.
			console.log('[model-inspector] selected mesh names:\n' + names);
		}
	}

	const selectedTris = $derived(controller.selection.reduce((sum, s) => sum + s.tris, 0));
</script>

<svelte:head><title>Model Inspector — SW 737</title></svelte:head>

<div class="inspector">
	<Canvas>
		<ModelView {wireframe} {controller} onStats={(s) => (stats = s)} />
	</Canvas>

	<div class="panel">
		<h1>SW 737 · Model Inspector</h1>

		<label class="toggle">
			<input type="checkbox" bind:checked={wireframe} />
			<span>Wireframe</span>
		</label>

		{#if stats}
			<dl class="stats">
				<div><dt>Meshes</dt><dd>{stats.meshes.toLocaleString()}</dd></div>
				<div><dt>Triangles</dt><dd>{stats.triangles.toLocaleString()}</dd></div>
				<div><dt>Materials</dt><dd>{stats.materials}</dd></div>
				<div><dt>Bounds</dt><dd>{stats.dims.map((d) => d.toFixed(0)).join(' × ')}</dd></div>
			</dl>
		{:else}
			<p class="loading">Loading model…</p>
		{/if}

		<!-- Selection tools -->
		<div class="section">
			<div class="section-head">
				<span>Selection</span>
				{#if controller.selection.length > 0}
					<span class="badge">{controller.selection.length} · {selectedTris.toLocaleString()} tris</span>
				{/if}
			</div>

			{#if controller.selection.length === 0}
				<p class="hint">Click a mesh to select · Shift-click to add more</p>
			{:else}
				<ul class="sel-list">
					{#each controller.selection as s (s.name)}
						<li><span class="sel-name">{s.name}</span><span class="sel-tris">{s.tris.toLocaleString()}</span></li>
					{/each}
				</ul>
			{/if}

			<div class="btn-row">
				<button onclick={() => controller.isolate?.()} disabled={controller.selection.length === 0}>Isolate</button>
				<button onclick={() => controller.hide?.()} disabled={controller.selection.length === 0}>Hide</button>
				<button onclick={() => controller.showAll?.()}>Show all</button>
			</div>
			<div class="btn-row">
				<button onclick={() => controller.clear?.()} disabled={controller.selection.length === 0}>Clear</button>
				<button onclick={copyNames} disabled={controller.selection.length === 0}>
					{copied ? 'Copied ✓' : 'Copy names'}
				</button>
			</div>
		</div>

		<div class="hint nav">drag rotate · scroll zoom · right-drag pan</div>

		<p class="credit">
			"Southwest Airlines Boeing 737" by A Random Modeler, licensed
			<a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC-BY-4.0</a>.
		</p>
	</div>
</div>

<style>
	.inspector {
		position: fixed;
		inset: 0;
		background: #16171c;
		overflow: hidden;
	}

	.panel {
		position: absolute;
		top: 16px;
		left: 16px;
		width: 250px;
		padding: 14px 16px;
		background: rgba(14, 15, 20, 0.85);
		backdrop-filter: blur(10px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		color: #d6d9e0;
		font-family: 'Ubuntu', system-ui, sans-serif;
		font-size: 13px;
		z-index: 10;
	}

	h1 {
		margin: 0 0 12px;
		font-size: 14px;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: #fff;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
		cursor: pointer;
		user-select: none;
	}
	.toggle input {
		accent-color: #7faeff;
	}

	.stats {
		margin: 0 0 12px;
		display: grid;
		gap: 4px;
	}
	.stats div {
		display: flex;
		justify-content: space-between;
		gap: 16px;
	}
	.stats dt {
		color: #8a8f9c;
	}
	.stats dd {
		margin: 0;
		font-family: ui-monospace, monospace;
		color: #7faeff;
	}

	.loading {
		margin: 0 0 12px;
		color: #8a8f9c;
		font-style: italic;
	}

	.section {
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		padding-top: 10px;
		margin-bottom: 10px;
	}
	.section-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #8a8f9c;
	}
	.badge {
		text-transform: none;
		letter-spacing: 0;
		font-family: ui-monospace, monospace;
		color: #ff9a52;
	}

	.sel-list {
		list-style: none;
		margin: 0 0 8px;
		padding: 0;
		max-height: 140px;
		overflow-y: auto;
		font-size: 11px;
	}
	.sel-list li {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 2px 0;
	}
	.sel-name {
		font-family: ui-monospace, monospace;
		color: #ffb07a;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sel-tris {
		font-family: ui-monospace, monospace;
		color: #6a6f7c;
		flex-shrink: 0;
	}

	.btn-row {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
	}
	button {
		flex: 1;
		padding: 5px 8px;
		font-size: 11px;
		font-family: inherit;
		color: #d6d9e0;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.12s;
	}
	button:hover:not(:disabled) {
		background: rgba(127, 174, 255, 0.18);
		border-color: rgba(127, 174, 255, 0.4);
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.hint {
		font-size: 11px;
		color: #6a6f7c;
		letter-spacing: 0.02em;
	}
	.hint.nav {
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		padding-top: 10px;
	}

	.credit {
		margin: 10px 0 0;
		font-size: 10px;
		line-height: 1.4;
		color: #585d6a;
	}
	.credit a {
		color: #7a8294;
	}
</style>
