<script lang="ts">
	/**
	 * Settings — Top-level parent feature component for all operator and admin drawers.
	 * Consolidates tuning and diagnostics panels via Svelte 5 snippets with shared glassmorphism styling.
	 */
	import { useDisplay } from '../display/display.svelte.js';
	import { Location } from './locations.js';

	interface Props {
		showSettings?: boolean;
		showAdmin?: boolean;
	}

	let { showSettings = $bindable(false), showAdmin = $bindable(false) }: Props = $props();

	const display = useDisplay();
	const config = display.config;
	const locations = Location.all();

	function setPlace(place: Location) {
		config.place = place;
		config.set('floorM', place.climbFloorM);
		config.set('ceilingM', place.climbCeilingM);
	}

	function reload() {
		if (typeof window !== 'undefined') window.location.reload();
	}
</script>

{#snippet tuningDrawer()}
	<aside class="glass-pane right">
		<header class="header">
			<h3>Settings & Tuning</h3>
			<button
				type="button"
				class="close-btn"
				onclick={() => (showSettings = false)}
				aria-label="Close settings">✕</button
			>
		</header>

		<div class="content">
			<section class="section">
				<h4>Camera View</h4>
				<label class="field">
					<span>Pitch ({Math.round(config.pitchDeg)}°)</span>
					<input
						type="range"
						min="-85"
						max="0"
						step="1"
						value={config.pitchDeg}
						oninput={(e) => config.set('pitchDeg', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Azimuth ({Math.round(config.azimuthDeg)}°)</span>
					<input
						type="range"
						min="-180"
						max="180"
						step="5"
						value={config.azimuthDeg}
						oninput={(e) => config.set('azimuthDeg', e.currentTarget.valueAsNumber)}
					/>
				</label>
			</section>

			<section class="section">
				<h4>Terrain & Visuals</h4>
				<label class="field">
					<span>High-Res Detail ({Math.round(config.detail * 100)}%)</span>
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={config.detail}
						oninput={(e) => config.set('detail', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Hillshade ({Math.round(config.shade * 100)}%)</span>
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={config.shade}
						oninput={(e) => config.set('shade', e.currentTarget.valueAsNumber)}
					/>
				</label>
			</section>

			<div class="actions">
				<button type="button" class="btn" onclick={() => config.reset()}>Reset Defaults</button>
			</div>
		</div>
	</aside>
{/snippet}

{#snippet adminDrawer()}
	<aside class="glass-pane left">
		<header class="header">
			<h3>Admin & Diagnostics</h3>
			<button
				type="button"
				class="close-btn"
				onclick={() => (showAdmin = false)}
				aria-label="Close admin">✕</button
			>
		</header>

		<div class="content">
			<section class="section">
				<h4>Location</h4>
				<div class="location-grid">
					{#each locations as loc}
						<button
							type="button"
							class="loc-btn"
							class:active={config.place.id === loc.id}
							onclick={() => setPlace(loc)}
						>
							{loc.name}
						</button>
					{/each}
				</div>
			</section>

			<section class="section">
				<h4>Live Telemetry</h4>
				<div class="telemetry-table">
					<div class="row">
						<span>Altitude</span>
						<strong>{Math.round(display.view.aglM ?? 0)} m AGL</strong>
					</div>
					<div class="row">
						<span>Heading</span>
						<strong>{Math.round(display.view.planeHeadingDeg ?? 0)}°</strong>
					</div>
					<div class="row">
						<span>Time of Day</span>
						<strong>{(display.view.timeOfDay ?? 0).toFixed(1)} h</strong>
					</div>
					<div class="row">
						<span>Atmosphere</span>
						<strong>{display.atmosphere.bandId}</strong>
					</div>
				</div>
			</section>

			<section class="section">
				<h4>Actions</h4>
				<button type="button" class="btn" onclick={reload}>Reload Display</button>
			</section>
		</div>
	</aside>
{/snippet}

{#if showSettings}
	{@render tuningDrawer()}
{/if}

{#if showAdmin}
	{@render adminDrawer()}
{/if}

<style>
	.glass-pane {
		position: absolute;
		top: 16px;
		width: 310px;
		background: var(--glass-bg);
		backdrop-filter: blur(var(--glass-blur));
		-webkit-backdrop-filter: blur(var(--glass-blur));
		border: 1px solid var(--glass-border);
		border-radius: var(--glass-radius);
		color: var(--text-primary);
		box-shadow: var(--glass-shadow);
		z-index: 100;
		overflow: hidden;
	}
	.glass-pane.left {
		left: 16px;
	}
	.glass-pane.right {
		right: 16px;
	}
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--glass-border-subtle);
	}
	.header h3 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.close-btn {
		background: none;
		border: none;
		color: var(--text-muted);
		font-size: 1rem;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: 4px;
	}
	.close-btn:hover {
		color: var(--text-primary);
		background: var(--glass-bg-hover);
	}
	.content {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.section h4 {
		margin: 0 0 8px 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.85rem;
		margin-bottom: 8px;
	}
	.field input[type='range'] {
		accent-color: var(--accent-cyan);
		cursor: pointer;
	}
	.location-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.loc-btn {
		padding: 8px 10px;
		border-radius: 6px;
		border: 1px solid var(--glass-border);
		background: var(--glass-bg-subtle);
		color: var(--text-primary);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
		text-align: center;
	}
	.loc-btn:hover {
		background: var(--glass-bg-hover);
	}
	.loc-btn.active {
		background: var(--accent-cyan-bg);
		border-color: var(--accent-cyan);
		color: var(--accent-cyan);
		font-weight: 600;
	}
	.telemetry-table {
		display: flex;
		flex-direction: column;
		gap: 6px;
		background: rgba(0, 0, 0, 0.25);
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 0.85rem;
	}
	.telemetry-table .row {
		display: flex;
		justify-content: space-between;
	}
	.telemetry-table .row span {
		color: var(--text-muted);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
	}
	.btn {
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid var(--glass-border);
		background: var(--glass-bg-subtle);
		color: var(--text-primary);
		font-size: 0.85rem;
		cursor: pointer;
		transition: background 0.15s;
	}
	.btn:hover {
		background: var(--glass-bg-hover);
	}
</style>
