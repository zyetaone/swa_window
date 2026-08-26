<script lang="ts">
	/**
	 * Settings — Top-level parent feature component for all operator and admin drawers.
	 * Consolidates tuning (Camera, Wing Alignment, Terrain/Visuals) and diagnostics panels
	 * via Svelte 5 snippets with shared glassmorphism styling.
	 */
	import { useDisplay } from '../display/display.svelte.js';
	import { Location } from './locations.js';
	import { KNOB_RANGE } from './settings.svelte.js';

	interface Props {
		showSettings?: boolean;
		showAdmin?: boolean;
	}

	let { showSettings = $bindable(false), showAdmin = $bindable(false) }: Props = $props();

	const display = useDisplay();
	const config = display.config;
	// Split, because they are different things: a city is orbited and looked at,
	// a feature is crossed. Showing them in one flat list implies the window
	// behaves the same over both, and it does not.
	const cities = Location.cities();
	const features = Location.features();

	// Everything the location defines — detail, floor, ceiling, phase — moves
	// with it. See PaneSettings.setPlace for why this is one call.
	const setPlace = (place: Location) => config.setPlace(place);

	// The hour the window is actually lit for, not the raw offset -- the offset
	// is the mechanism, the clock is what the operator is looking at.
	const clockLabel = $derived.by(() => {
		const h = display.view.timeOfDay ?? 0;
		const hh = Math.floor(h);
		const mm = Math.round((h - hh) * 60);
		const stamp = `${String(hh % 24).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
		const off = config.clockOffsetH;
		return off === 0 ? `${stamp} local` : `${stamp} · ${off > 0 ? '+' : ''}${off}h`;
	});

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
						min={KNOB_RANGE.pitchDeg[0]}
						max={KNOB_RANGE.pitchDeg[1]}
						step="1"
						value={config.pitchDeg}
						oninput={(e) => config.set('pitchDeg', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Azimuth ({Math.round(config.azimuthDeg)}°)</span>
					<input
						type="range"
						min={KNOB_RANGE.azimuthDeg[0]}
						max={KNOB_RANGE.azimuthDeg[1]}
						step="5"
						value={config.azimuthDeg}
						oninput={(e) => config.set('azimuthDeg', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Flight Speed Multiplier ({config.speed.toFixed(1)}x)</span>
					<input
						type="range"
						min={KNOB_RANGE.speed[0]}
						max={KNOB_RANGE.speed[1]}
						step="0.1"
						value={config.speed}
						oninput={(e) => config.set('speed', e.currentTarget.valueAsNumber)}
					/>
				</label>
			</section>

			<section class="section">
				<h4>Flight Envelope & Light</h4>
				<label class="field">
					<span
						>Altitude Floor ({Math.round(config.floorM).toLocaleString()} m &middot; {Math.round(
							config.floorM * 3.28084
						).toLocaleString()} ft)</span
					>
					<input
						type="range"
						min={KNOB_RANGE.floorM[0]}
						max={KNOB_RANGE.floorM[1]}
						step="100"
						value={config.floorM}
						oninput={(e) => config.set('floorM', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span
						>Altitude Ceiling ({Math.round(config.ceilingM).toLocaleString()} m &middot; {Math.round(
							config.ceilingM * 3.28084
						).toLocaleString()} ft)</span
					>
					<input
						type="range"
						min={KNOB_RANGE.ceilingM[0]}
						max={KNOB_RANGE.ceilingM[1]}
						step="100"
						value={config.ceilingM}
						oninput={(e) => config.set('ceilingM', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<p class="section-note">
					Metres above ground. The floor must clear local high ground &mdash; the camera flies at
					floor + terrain, so 400 m over the Front Range puts you inside it.
				</p>

				<label class="field">
					<span>Time of Day ({clockLabel})</span>
					<input
						type="range"
						min={KNOB_RANGE.clockOffsetH[0]}
						max={KNOB_RANGE.clockOffsetH[1]}
						step="0.25"
						value={config.clockOffsetH}
						oninput={(e) => config.set('clockOffsetH', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<p class="section-note">
					Shifts the destination clock, so sun, night and haze all move together and keep advancing.
					Anything but 0 desyncs this pane from the other two &mdash; desk tuning only.
				</p>
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
						min={KNOB_RANGE.wingScale[0]}
						max={KNOB_RANGE.wingScale[1]}
						step="0.05"
						value={config.wingScale}
						oninput={(e) => config.set('wingScale', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Horizontal Offset X ({Math.round(config.wingOffsetX)} px)</span>
					<input
						type="range"
						min={KNOB_RANGE.wingOffsetX[0]}
						max={KNOB_RANGE.wingOffsetX[1]}
						step="5"
						value={config.wingOffsetX}
						oninput={(e) => config.set('wingOffsetX', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Vertical Offset Y ({Math.round(config.wingOffsetY)} px)</span>
					<input
						type="range"
						min={KNOB_RANGE.wingOffsetY[0]}
						max={KNOB_RANGE.wingOffsetY[1]}
						step="5"
						value={config.wingOffsetY}
						oninput={(e) => config.set('wingOffsetY', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Wing Pitch Offset ({config.wingPitchDeg.toFixed(1)}°)</span>
					<input
						type="range"
						min={KNOB_RANGE.wingPitchDeg[0]}
						max={KNOB_RANGE.wingPitchDeg[1]}
						step="0.5"
						value={config.wingPitchDeg}
						oninput={(e) => config.set('wingPitchDeg', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Banking Roll Response ({config.wingRollFactor.toFixed(2)}x)</span>
					<input
						type="range"
						min={KNOB_RANGE.wingRollFactor[0]}
						max={KNOB_RANGE.wingRollFactor[1]}
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
						min={KNOB_RANGE.detail[0]}
						max={KNOB_RANGE.detail[1]}
						step="0.05"
						value={config.detail}
						oninput={(e) => config.set('detail', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Hillshade ({Math.round(config.shade * 100)}%)</span>
					<input
						type="range"
						min={KNOB_RANGE.shade[0]}
						max={KNOB_RANGE.shade[1]}
						step="0.05"
						value={config.shade}
						oninput={(e) => config.set('shade', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>3D Terrain Exaggeration ({config.exaggeration.toFixed(2)}x)</span>
					<input
						type="range"
						min={KNOB_RANGE.exaggeration[0]}
						max={KNOB_RANGE.exaggeration[1]}
						step="0.05"
						value={config.exaggeration}
						oninput={(e) => config.set('exaggeration', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="checkbox-field">
					<input
						type="checkbox"
						checked={config.colorRelief}
						onchange={(e) => (config.colorRelief = e.currentTarget.checked)}
					/>
					<span>Hypsometric Color Relief Tint</span>
				</label>
			</section>

			<section class="section">
				<h4>Atmospheric Cloud Deck</h4>
				<label class="checkbox-field">
					<input
						type="checkbox"
						checked={config.clouds}
						onchange={(e) => (config.clouds = e.currentTarget.checked)}
					/>
					<span>Show Cloud Deck</span>
				</label>
				<label class="field">
					<span>Cloud Density ({Math.round(config.cloudDensity * 100)}%)</span>
					<input
						type="range"
						min={KNOB_RANGE.cloudDensity[0]}
						max={KNOB_RANGE.cloudDensity[1]}
						step="0.05"
						value={config.cloudDensity}
						oninput={(e) => config.set('cloudDensity', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Drift Speed ({config.cloudSpeed.toFixed(1)}x)</span>
					<input
						type="range"
						min={KNOB_RANGE.cloudSpeed[0]}
						max={KNOB_RANGE.cloudSpeed[1]}
						step="0.1"
						value={config.cloudSpeed}
						oninput={(e) => config.set('cloudSpeed', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Deck Altitude ({Math.round(config.cloudAltitudeM).toLocaleString()} m)</span>
					<input
						type="range"
						min={KNOB_RANGE.cloudAltitudeM[0]}
						max={KNOB_RANGE.cloudAltitudeM[1]}
						step="250"
						value={config.cloudAltitudeM}
						oninput={(e) => config.set('cloudAltitudeM', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>Cloud Opacity ({Math.round(config.cloudOpacity * 100)}%)</span>
					<input
						type="range"
						min={KNOB_RANGE.cloudOpacity[0]}
						max={KNOB_RANGE.cloudOpacity[1]}
						step="0.05"
						value={config.cloudOpacity}
						oninput={(e) => config.set('cloudOpacity', e.currentTarget.valueAsNumber)}
					/>
				</label>
			</section>

			<section class="section">
				<h4>Weather & Environment</h4>
				<div class="location-grid">
					{#each ['clear', 'cloudy', 'rain', 'overcast', 'storm'] as const as w}
						<button
							type="button"
							class="loc-btn"
							class:active={config.weather === w}
							onclick={() => (config.weather = w)}
						>
							{w.toUpperCase()}
						</button>
					{/each}
				</div>
			</section>

			<section class="section">
				<h4>Cabin Chrome & Ambient Audio</h4>
				<label class="checkbox-field">
					<input
						type="checkbox"
						checked={config.blindOpen}
						onchange={(e) => (config.blindOpen = e.currentTarget.checked)}
					/>
					<span>Window Blind Open</span>
				</label>
				<label class="checkbox-field">
					<input
						type="checkbox"
						checked={config.audioEnabled}
						onchange={(e) => (config.audioEnabled = e.currentTarget.checked)}
					/>
					<span>Cabin Engine Soundscape</span>
				</label>
				{#if config.audioEnabled}
					<label class="field">
						<span>Engine Volume ({Math.round(config.audioVolume * 100)}%)</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={config.audioVolume}
							oninput={(e) => (config.audioVolume = e.currentTarget.valueAsNumber)}
						/>
					</label>
				{/if}
			</section>

			<section class="section">
				<h4>Multi-Pi Wall Role & Display Mode</h4>
				<div class="location-grid">
					{#each ['solo', 'left', 'center', 'right'] as const as role}
						<button
							type="button"
							class="loc-btn"
							class:active={config.fleetRole === role}
							onclick={() => (config.fleetRole = role)}
						>
							{role.toUpperCase()}
						</button>
					{/each}
				</div>
				<div class="location-grid" style="margin-top: 8px;">
					{#each ['flight', 'video', 'screensaver', 'standby'] as const as mode}
						<button
							type="button"
							class="loc-btn"
							class:active={config.displayMode === mode}
							onclick={() => (config.displayMode = mode)}
						>
							{mode.toUpperCase()}
						</button>
					{/each}
				</div>
			</section>

			<section class="section">
				<h4>3D Geospatial Engine</h4>
				<div class="location-grid">
					{#each ['maplibre', 'cesium'] as const as eng}
						<button
							type="button"
							class="loc-btn"
							class:active={config.engine === eng}
							onclick={() => (config.engine = eng)}
						>
							{eng === 'maplibre' ? 'MAPLIBRE (LEAN)' : 'CESIUM (WGS84)'}
						</button>
					{/each}
				</div>
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
				<h4>Cities</h4>
				<div class="location-grid">
					{#each cities as loc}
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
				<h4>In Transit</h4>
				<p class="section-note">
					Terrain crossed rather than circled — the view looks along the track.
				</p>
				<div class="location-grid">
					{#each features as loc}
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
				<h4>Configuration & Fleet Sync</h4>
				<div class="admin-actions-grid">
					<button
						type="button"
						class="btn"
						onclick={() => {
							config.applyUrl(new URL(window.location.href));
						}}
					>
						🔄 Update & Sync URL
					</button>
					<button
						type="button"
						class="btn"
						onclick={() => {
							const u = new URL(window.location.href);
							u.searchParams.set('place', config.place.id);
							u.searchParams.set('azimuth', config.azimuthDeg.toString());
							u.searchParams.set('pitch', config.pitchDeg.toString());
							u.searchParams.set('speed', config.speed.toString());
							u.searchParams.set('wingScale', config.wingScale.toString());
							u.searchParams.set('wingX', config.wingOffsetX.toString());
							u.searchParams.set('wingY', config.wingOffsetY.toString());
							window.history.replaceState({}, '', u.toString());
							navigator.clipboard?.writeText(u.toString());
						}}
					>
						📋 Copy Shareable URL
					</button>
				</div>
			</section>

			<section class="section">
				<h4>Display Mode Push</h4>
				<div class="mode-push-grid">
					<button type="button" class="btn active-mode">✈️ Flight Globe</button>
					<button type="button" class="btn">🎬 Video Stage</button>
					<button type="button" class="btn">🖼️ Slideshow</button>
					<button type="button" class="btn">🌑 Standby</button>
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
	.section-note {
		margin: -0.15rem 0 0.45rem;
		font-size: 0.62rem;
		line-height: 1.35;
		color: rgba(255, 255, 255, 0.45);
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
	.admin-actions-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.mode-push-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.active-mode {
		background: var(--accent-cyan-bg);
		border-color: var(--accent-cyan);
		color: var(--accent-cyan);
		font-weight: 600;
	}
</style>
