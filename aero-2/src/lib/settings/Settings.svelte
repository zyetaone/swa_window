<script lang="ts">
	/**
	 * Settings — Operator Tuning Drawer & System Diagnostics Panel.
	 * Categorized into 6 logical operator tabs with dual range/number inputs and toggle switches.
	 */
	import { useDisplay } from '../display/display.svelte.js';
	import { Location, LOCATIONS } from './locations.js';
	import { SCENE_PRESETS } from './presets.js';
	import Knob from './Knob.svelte';
	import Toggle from './Toggle.svelte';

	interface Props {
		showSettings?: boolean;
		showAdmin?: boolean;
	}

	let { showSettings = $bindable(false), showAdmin = $bindable(false) }: Props = $props();

	const display = useDisplay();
	const config = display.config;
	const cities = Location.cities();
	const features = Location.features();

	type TabId = 'presets' | 'camera' | 'wing' | 'atmosphere' | 'terrain' | 'cabin' | 'fleet';
	let activeTab = $state<TabId>('presets');

	const clockLabel = $derived.by(() => {
		const h = display.view.timeOfDay ?? 0;
		const hh = Math.floor(h);
		const mm = Math.round((h - hh) * 60);
		const stamp = `${String(hh % 24).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
		const off = config.clockOffsetH;
		return off === 0 ? `${stamp} local` : `${stamp} · ${off > 0 ? '+' : ''}${off}h`;
	});

	interface NetworkStatus {
		hostname: string;
		primaryLanIp: string;
		lanIps: { name: string; address: string }[];
		port: number;
	}
	let networkStatus = $state<NetworkStatus | null>(null);

	$effect(() => {
		if (showAdmin) {
			fetch('/api/status')
				.then((res) => res.json())
				.then((data) => {
					networkStatus = data;
				})
				.catch(() => {});
		}
	});

	function reload() {
		if (typeof window !== 'undefined') window.location.reload();
	}
</script>

{#snippet tuningDrawer()}
	<aside class="glass-pane right">
		<header class="header">
			<h3>Settings & Operator Tuning</h3>
			<button
				type="button"
				class="close-btn"
				onclick={() => (showSettings = false)}
				aria-label="Close settings">✕</button
			>
		</header>

		<!-- Subsystem Navigation Tabs -->
		<nav class="tab-bar">
			<button
				type="button"
				class="tab-btn"
				class:active={activeTab === 'presets'}
				onclick={() => (activeTab = 'presets')}>🎯 Presets</button
			>
			<button
				type="button"
				class="tab-btn"
				class:active={activeTab === 'camera'}
				onclick={() => (activeTab = 'camera')}>📷 Camera</button
			>
			<button
				type="button"
				class="tab-btn"
				class:active={activeTab === 'wing'}
				onclick={() => (activeTab = 'wing')}>✈️ Airframe</button
			>
			<button
				type="button"
				class="tab-btn"
				class:active={activeTab === 'atmosphere'}
				onclick={() => (activeTab = 'atmosphere')}>☁️ Atmosphere</button
			>
			<button
				type="button"
				class="tab-btn"
				class:active={activeTab === 'terrain'}
				onclick={() => (activeTab = 'terrain')}>🗺️ Terrain</button
			>
			<button
				type="button"
				class="tab-btn"
				class:active={activeTab === 'cabin'}
				onclick={() => (activeTab = 'cabin')}>🎛️ Cabin</button
			>
		</nav>

		<div class="content">
			{#if activeTab === 'presets'}
				<section class="section">
					<h4>Scene Composition Presets</h4>
					<div class="preset-grid">
						{#each SCENE_PRESETS as preset}
							<button
								type="button"
								class="preset-card"
								onclick={() => config.applyPreset(preset)}
							>
								<div class="preset-top">
									<span class="preset-icon">{preset.icon}</span>
									<span class="preset-badge">{preset.badge}</span>
								</div>
								<div class="preset-title">{preset.name}</div>
								<div class="preset-desc">{preset.description}</div>
							</button>
						{/each}
					</div>
				</section>

				<section class="section">
					<h4>Destination Selector</h4>
					<div class="location-select-wrap">
						<select
							class="glass-select"
							value={config.place.id}
							onchange={(e) => {
								const loc = Location.byId(e.currentTarget.value);
								if (loc) config.setPlace(loc);
							}}
							aria-label="Select destination"
						>
							<optgroup label="Cities (Orbital Tour)">
								{#each cities as city}
									<option value={city.id}>{city.name} ({city.groundElevationM}m MSL)</option>
								{/each}
							</optgroup>
							<optgroup label="Natural Features (Cross-Country)">
								{#each features as feat}
									<option value={feat.id}>{feat.name} ({feat.groundElevationM}m MSL)</option>
								{/each}
							</optgroup>
						</select>
					</div>

					<div class="location-grid" style="margin-top: 8px;">
						{#each LOCATIONS as loc}
							<button
								type="button"
								class="loc-btn"
								class:active={config.place.id === loc.id}
								onclick={() => config.setPlace(loc)}
							>
								{loc.name}
							</button>
						{/each}
					</div>
				</section>
			{:else if activeTab === 'camera'}
				<section class="section">
					<h4>Camera Sightline & Perspective</h4>
					<Knob
						{config}
						key="pitchDeg"
						label="Camera Pitch"
						step={1}
						format={(v) => `${Math.round(v)}°`}
					/>
					<Knob
						{config}
						key="azimuthDeg"
						label="Camera Azimuth"
						step={5}
						format={(v) => `${Math.round(v)}°`}
					/>
					<Knob
						{config}
						key="speed"
						label="Flight Speed Multiplier"
						step={0.1}
						format={(v) => `${v.toFixed(1)}x`}
					/>
				</section>

				<section class="section">
					<h4>Flight Envelope & Circadian Clock</h4>
					<Knob
						{config}
						key="floorM"
						label="Altitude Floor"
						step={100}
						format={(v) =>
							`${Math.round(v).toLocaleString()} m · ${Math.round(v * 3.28084).toLocaleString()} ft`}
					/>
					<Knob
						{config}
						key="ceilingM"
						label="Altitude Ceiling"
						step={100}
						format={(v) =>
							`${Math.round(v).toLocaleString()} m · ${Math.round(v * 3.28084).toLocaleString()} ft`}
					/>
					<Knob
						{config}
						key="clockOffsetH"
						label="Circadian Time of Day"
						step={0.25}
						format={() => clockLabel}
					/>
				</section>
			{:else if activeTab === 'wing'}
				<section class="section">
					<h4>Aircraft Airframe (3D Boeing 737)</h4>
					<Toggle
						checked={config.wing}
						label="Show 3D Wing Airframe"
						description="Render WebGL wing with strobe beacons and navigation lights"
						onchange={(val) => (config.wing = val)}
					/>
					<Knob
						{config}
						key="wingScale"
						label="Wing Scale"
						step={0.05}
						format={(v) => `${v.toFixed(2)}x`}
					/>
					<Knob
						{config}
						key="wingOffsetX"
						label="Horizontal Offset X"
						step={5}
						format={(v) => `${Math.round(v)} px`}
					/>
					<Knob
						{config}
						key="wingOffsetY"
						label="Vertical Offset Y"
						step={5}
						format={(v) => `${Math.round(v)} px`}
					/>
					<Knob
						{config}
						key="wingPitchDeg"
						label="Wing Pitch Offset"
						step={0.5}
						format={(v) => `${v.toFixed(1)}°`}
					/>
					<Knob
						{config}
						key="wingRollFactor"
						label="Banking Roll Response"
						step={0.1}
						format={(v) => `${v.toFixed(2)}x`}
					/>
				</section>
			{:else if activeTab === 'atmosphere'}
				<section class="section">
					<h4>Weather Condition</h4>
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
					<h4>Atmospheric Cloud Deck</h4>
					<Toggle
						checked={config.clouds}
						label="Volumetric Cloud Deck"
						description="Multi-tier altitude cloud deck (cumulus, mid deck, and high cirrus veil)"
						onchange={(val) => (config.clouds = val)}
					/>
					<Knob
						{config}
						key="cloudDensity"
						label="Cloud Density"
						step={0.05}
						format={(v) => `${Math.round(v * 100)}%`}
					/>
					<Knob
						{config}
						key="cloudSpeed"
						label="Drift Speed"
						step={0.1}
						format={(v) => `${v.toFixed(1)}x`}
					/>
					<Knob
						{config}
						key="cloudAltitudeM"
						label="Deck Base Altitude"
						step={250}
						format={(v) => `${Math.round(v).toLocaleString()} m`}
					/>
					<Knob
						{config}
						key="cloudOpacity"
						label="Cloud Opacity"
						step={0.05}
						format={(v) => `${Math.round(v * 100)}%`}
					/>
				</section>
			{:else if activeTab === 'terrain'}
				<section class="section">
					<h4>3D Terrain & Satellite Imagery</h4>
					<Knob
						{config}
						key="detail"
						label="Satellite High-Res Detail"
						step={0.05}
						format={(v) => `${Math.round(v * 100)}%`}
					/>
					<Knob
						{config}
						key="shade"
						label="Topological Hillshade"
						step={0.05}
						format={(v) => `${Math.round(v * 100)}%`}
					/>
					<Knob
						{config}
						key="exaggeration"
						label="3D Terrain Elevation Exaggeration"
						step={0.05}
						format={(v) => `${v.toFixed(2)}x`}
					/>
					<Toggle
						checked={config.colorRelief}
						label="Hypsometric Color Relief"
						description="Apply elevation gradient tint layer to terrain"
						onchange={(val) => (config.colorRelief = val)}
					/>
				</section>

				<section class="section">
					<h4>Rendering Engine</h4>
					<div class="location-grid">
						{#each ['maplibre', 'cesium'] as const as eng}
							<button
								type="button"
								class="loc-btn"
								class:active={config.engine === eng}
								onclick={() => (config.engine = eng)}
							>
								{eng.toUpperCase()}
							</button>
						{/each}
					</div>
				</section>
			{:else if activeTab === 'cabin'}
				<section class="section">
					<h4>Cabin Chrome & Soundscape</h4>
					<Toggle
						checked={config.blindOpen}
						label="Window Blind Open"
						description="Motorized passenger window blind"
						onchange={(val) => (config.blindOpen = val)}
					/>
					<Toggle
						checked={config.audioEnabled}
						label="Cabin Audio Soundscape"
						description="Jet engine turbine drone and atmospheric airflow"
						onchange={(val) => (config.audioEnabled = val)}
					/>

					{#if config.audioEnabled}
						<div class="location-grid" style="margin: 8px 0;">
							<button
								type="button"
								class="loc-btn"
								class:active={config.audioMode === 'synth'}
								onclick={() => (config.audioMode = 'synth')}
							>
								SYNTH ENGINE
							</button>
							<button
								type="button"
								class="loc-btn"
								class:active={config.audioMode === 'playlist'}
								onclick={() => (config.audioMode = 'playlist')}
							>
								AUDIO PLAYLIST
							</button>
						</div>

						<Knob
							{config}
							key="audioVolume"
							label="Audio Volume"
							step={0.05}
							format={(v) => `${Math.round(v * 100)}%`}
						/>
					{/if}
				</section>

				<section class="section">
					<h4>Multi-Pi Fleet Parallax Role</h4>
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
				</section>
			{/if}
		</div>
	</aside>
{/snippet}

{#snippet adminDrawer()}
	<aside class="glass-pane left">
		<header class="header">
			<h3>Admin & System Diagnostics</h3>
			<button
				type="button"
				class="close-btn"
				onclick={() => (showAdmin = false)}
				aria-label="Close admin">✕</button
			>
		</header>

		<div class="content">
			<section class="section">
				<h4>System Telemetry</h4>
				<div class="diag-list">
					<div class="diag-item">
						<span class="diag-label">FPS Target:</span>
						<span class="diag-value">{Math.round(display.fps)} FPS</span>
					</div>
					<div class="diag-item">
						<span class="diag-label">Frame Time:</span>
						<span class="diag-value">{display.frameTimeMs.toFixed(1)} ms</span>
					</div>
					<div class="diag-item">
						<span class="diag-label">Engine:</span>
						<span class="diag-value">{config.engine.toUpperCase()}</span>
					</div>
					<div class="diag-item">
						<span class="diag-label">Altitude:</span>
						<span class="diag-value">{(display.view.aglM ?? 0).toLocaleString()} m AGL</span>
					</div>
					<div class="diag-item">
						<span class="diag-label">Flight Heading:</span>
						<span class="diag-value">{Math.round(display.view.planeHeadingDeg ?? 0)}°</span>
					</div>
				</div>
			</section>

			{#if networkStatus}
				<section class="section">
					<h4>Network Host Discovery</h4>
					<div class="diag-list">
						<div class="diag-item">
							<span class="diag-label">Hostname:</span>
							<span class="diag-value">{networkStatus.hostname}</span>
						</div>
						<div class="diag-item">
							<span class="diag-label">Primary IP:</span>
							<span class="diag-value">{networkStatus.primaryLanIp || '127.0.0.1'}</span>
						</div>
						<div class="diag-item">
							<span class="diag-label">Port:</span>
							<span class="diag-value">{networkStatus.port}</span>
						</div>
					</div>
				</section>
			{/if}

			<section class="section">
				<h4>Kiosk Actions</h4>
				<div class="action-buttons">
					<button type="button" class="glass-btn primary" onclick={reload}>
						🔄 Soft Reload
					</button>
					<a href="/admin" class="glass-btn secondary" style="text-align: center; text-decoration: none;">
						🖥️ Open Fleet Cockpit
					</a>
				</div>
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
		top: 0;
		bottom: 0;
		width: 380px;
		background: rgba(11, 17, 30, 0.88);
		backdrop-filter: blur(16px);
		border: 1px solid rgba(255, 255, 255, 0.12);
		z-index: 100;
		display: flex;
		flex-direction: column;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
		color: #f8fafc;
	}
	.glass-pane.right {
		right: 0;
		border-right: none;
	}
	.glass-pane.left {
		left: 0;
		border-left: none;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}
	.header h3 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.close-btn {
		background: none;
		border: none;
		color: #94a3b8;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 4px;
	}
	.close-btn:hover {
		color: #ffffff;
	}

	.tab-bar {
		display: flex;
		overflow-x: auto;
		background: rgba(0, 0, 0, 0.25);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		padding: 4px 8px;
		gap: 4px;
		scrollbar-width: none;
	}
	.tab-btn {
		background: none;
		border: none;
		padding: 6px 10px;
		color: #94a3b8;
		font-size: 0.78rem;
		font-weight: 500;
		border-radius: 4px;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s ease;
	}
	.tab-btn:hover {
		color: #f8fafc;
		background: rgba(255, 255, 255, 0.05);
	}
	.tab-btn.active {
		color: #ffffff;
		background: var(--accent-cyan, #38bdf8);
		font-weight: 600;
	}

	.content {
		flex: 1;
		overflow-y: auto;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.section h4 {
		margin: 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #94a3b8;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		padding-bottom: 0.4rem;
	}

	.preset-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 8px;
	}
	.preset-card {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		padding: 10px;
		text-align: left;
		cursor: pointer;
		transition: all 0.15s ease;
		color: inherit;
	}
	.preset-card:hover {
		background: rgba(255, 255, 255, 0.08);
		border-color: rgba(56, 189, 248, 0.4);
		transform: translateY(-1px);
	}
	.preset-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
	}
	.preset-icon {
		font-size: 1.1rem;
	}
	.preset-badge {
		font-size: 0.65rem;
		padding: 2px 6px;
		background: rgba(56, 189, 248, 0.15);
		color: #38bdf8;
		border-radius: 4px;
		text-transform: uppercase;
		font-weight: 600;
	}
	.preset-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #ffffff;
		margin-bottom: 2px;
	}
	.preset-desc {
		font-size: 0.72rem;
		color: #94a3b8;
		line-height: 1.3;
	}

	.glass-select {
		width: 100%;
		padding: 8px 12px;
		background: rgba(0, 0, 0, 0.45);
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-radius: 6px;
		color: #ffffff;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.glass-select:focus {
		outline: none;
		border-color: var(--accent-cyan, #38bdf8);
	}
	.glass-select option, .glass-select optgroup {
		background: #0f172a;
		color: #ffffff;
	}

	.location-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}
	.loc-btn {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 4px;
		padding: 6px 4px;
		color: #cbd5e1;
		font-size: 0.72rem;
		cursor: pointer;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: all 0.15s ease;
	}
	.loc-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: #ffffff;
	}
	.loc-btn.active {
		background: var(--accent-cyan, #38bdf8);
		color: #0b111e;
		font-weight: 600;
		border-color: var(--accent-cyan, #38bdf8);
	}

	.diag-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		background: rgba(0, 0, 0, 0.3);
		padding: 10px;
		border-radius: 6px;
		border: 1px solid rgba(255, 255, 255, 0.08);
	}
	.diag-item {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
	}
	.diag-label {
		color: #94a3b8;
	}
	.diag-value {
		color: #f8fafc;
		font-family: monospace;
	}

	.action-buttons {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.glass-btn {
		padding: 8px 14px;
		border-radius: 6px;
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		border: 1px solid rgba(255, 255, 255, 0.15);
	}
	.glass-btn.primary {
		background: var(--accent-cyan, #38bdf8);
		color: #0b111e;
		font-weight: 600;
	}
	.glass-btn.secondary {
		background: rgba(255, 255, 255, 0.08);
		color: #ffffff;
	}
	.glass-btn:hover {
		opacity: 0.9;
	}
</style>
