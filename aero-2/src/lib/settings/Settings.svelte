<script lang="ts">
	/**
	 * Settings — Top-level parent feature component for all operator and admin drawers.
	 * Consolidates tuning (Camera, Wing Alignment, Terrain/Visuals) and diagnostics panels
	 * via Svelte 5 snippets with shared glassmorphism styling.
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
				<h4>Aircraft Wing Alignment</h4>
				<label class="checkbox-field">
					<input
						type="checkbox"
						checked={config.wing}
						onchange={(e) => (config.wing = e.currentTarget.checked)}
					/>
					<span>Show Wing</span>
				</label>
				<div class="mode-toggle">
					<button
						type="button"
						class="mode-btn"
						class:active={config.wingMode === '3d'}
						onclick={() => (config.wingMode = '3d')}
					>
						3D Boeing 737
					</button>
					<button
						type="button"
						class="mode-btn"
						class:active={config.wingMode === '2d'}
						onclick={() => (config.wingMode = '2d')}
					>
						2D Vector
					</button>
				</div>
				<label class="field">
					<span>Wing Scale ({config.wingScale.toFixed(2)}x)</span>
					<input
						type="range"
						min="0.3"
						max="3.0"
						step="0.05"
						value={config.wingScale}
						oninput={(e) => config.set('wingScale', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Horizontal Offset X ({Math.round(config.wingOffsetX)} px)</span>
					<input
						type="range"
						min="-500"
						max="500"
						step="5"
						value={config.wingOffsetX}
						oninput={(e) => config.set('wingOffsetX', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Vertical Offset Y ({Math.round(config.wingOffsetY)} px)</span>
					<input
						type="range"
						min="-500"
						max="500"
						step="5"
						value={config.wingOffsetY}
						oninput={(e) => config.set('wingOffsetY', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Wing Pitch Offset ({config.wingPitchDeg.toFixed(1)}°)</span>
					<input
						type="range"
						min="-45"
						max="45"
						step="0.5"
						value={config.wingPitchDeg}
						oninput={(e) => config.set('wingPitchDeg', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Banking Roll Response ({config.wingRollFactor.toFixed(2)}x)</span>
					<input
						type="range"
						min="0"
						max="3.0"
						step="0.1"
						value={config.wingRollFactor}
						oninput={(e) => config.set('wingRollFactor', e.currentTarget.valueAsNumber)}
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
				<h4>Flight Direction</h4>
				<div class="direction-control">
					<button type="button" class="btn direction-btn" onclick={() => config.reverse()}>
						Direction: {config.direction === 1 ? 'Clockwise (↻)' : 'Counter-Clockwise (↺)'}
					</button>
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
						<span>Bank Roll</span>
						<strong
							>{display.view.bankDeg !== undefined
								? display.view.bankDeg.toFixed(1)
								: '0.0'}°</strong
						>
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

<!-- Floating Corner Trigger Tabs (when drawers are closed) -->
{#if !showSettings}
	<button
		type="button"
		class="corner-tab right"
		onclick={() => (showSettings = true)}
		aria-label="Open Settings"
		title="Open Settings & Tuning (Press 'S')"
	>
		⚙️ Tuning
	</button>
{/if}

{#if !showAdmin}
	<button
		type="button"
		class="corner-tab left"
		onclick={() => (showAdmin = true)}
		aria-label="Open Admin Diagnostics"
		title="Open Admin Diagnostics (Press 'A')"
	>
		🛠️ Admin
	</button>
{/if}

{#if showSettings}
	{@render tuningDrawer()}
{/if}

{#if showAdmin}
	{@render adminDrawer()}
{/if}

<style>
	.corner-tab {
		position: absolute;
		top: 16px;
		padding: 6px 12px;
		background: var(--glass-bg);
		backdrop-filter: blur(var(--glass-blur));
		-webkit-backdrop-filter: blur(var(--glass-blur));
		border: 1px solid var(--glass-border);
		border-radius: 9999px;
		color: var(--text-primary);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
		z-index: 90;
		transition: all 0.15s;
		user-select: none;
	}
	.corner-tab.left {
		left: 16px;
	}
	.corner-tab.right {
		right: 16px;
	}
	.corner-tab:hover {
		background: var(--glass-bg-hover);
		border-color: var(--accent-cyan);
		color: var(--accent-cyan);
		transform: translateY(-1px);
	}

	.glass-pane {
		position: absolute;
		top: 16px;
		width: 320px;
		max-height: calc(100vh - 32px);
		background: var(--glass-bg);
		backdrop-filter: blur(var(--glass-blur));
		-webkit-backdrop-filter: blur(var(--glass-blur));
		border: 1px solid var(--glass-border);
		border-radius: var(--glass-radius);
		color: var(--text-primary);
		box-shadow: var(--glass-shadow);
		z-index: 100;
		overflow-y: auto;
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
		position: sticky;
		top: 0;
		background: rgba(15, 23, 42, 0.75);
		backdrop-filter: blur(var(--glass-blur));
		z-index: 2;
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
	.checkbox-field {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.85rem;
		margin-bottom: 8px;
		cursor: pointer;
	}
	.checkbox-field input[type='checkbox'] {
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
	.mode-toggle {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		margin-bottom: 12px;
	}
	.mode-btn {
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid var(--glass-border);
		background: var(--glass-bg-subtle);
		color: var(--text-primary);
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.15s;
		text-align: center;
	}
	.mode-btn:hover {
		background: var(--glass-bg-hover);
	}
	.mode-btn.active {
		background: var(--accent-cyan-bg);
		border-color: var(--accent-cyan);
		color: var(--accent-cyan);
		font-weight: 600;
	}
	.direction-control {
		display: flex;
	}
	.direction-btn {
		width: 100%;
		text-align: center;
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
