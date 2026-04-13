<script lang="ts">
	import { AdminStore, type Transport } from '$lib/services/fleet-admin.svelte';
	import type { LocationId, WeatherType, DisplayMode, DisplayConfig } from '$lib/shared';
	import { LOCATIONS, type QualityMode } from '$lib/shared';
	import { onDestroy } from 'svelte';

	// Read config from URL params: ?server=ws://...&transport=sse
	const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
	const serverParam = params?.get('server') || undefined;
	const transportParam = (params?.get('transport') as Transport) || undefined;
	const store = new AdminStore(serverParam, transportParam);
	onDestroy(() => store.destroy());

	// Selection state
	let selectedDevices = $state<Set<string>>(new Set());
	let sceneLocation = $state<LocationId>('dallas');
	let sceneWeather = $state<WeatherType>('clear');
	let pushMode = $state<DisplayMode>('flight');
	let videoUrl = $state('');

	// Config controls — fine-grained display overrides
	// These push live to selected devices on change (debounced 200ms)
	let cfgAltitude = $state(35000);
	let cfgTimeOfDay = $state(12);
	let cfgFlightSpeed = $state(1.0);
	let cfgCloudDensity = $state(0.7);
	let cfgNightLightIntensity = $state(0.6);
	let cfgSyncToRealTime = $state(true);
	let cfgShowClouds = $state(true);
	let cfgQualityMode = $state<QualityMode>('balanced');

	// Derived display labels for sliders
	const altitudeLabel = $derived(`${(cfgAltitude / 1000).toFixed(0)}k ft`);
	const timeLabel = $derived.by(() => {
		const h = Math.floor(cfgTimeOfDay);
		const m = Math.floor((cfgTimeOfDay % 1) * 60);
		const period = h >= 12 ? 'PM' : 'AM';
		const h12 = h % 12 || 12;
		return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
	});
	const speedLabel = $derived(`${cfgFlightSpeed.toFixed(1)}x`);
	const cloudLabel = $derived(`${Math.round(cfgCloudDensity * 100)}%`);
	const nightLabel = $derived(cfgNightLightIntensity.toFixed(1));

	// Live push: debounced config sync on slider change
	let livePushTimeout: ReturnType<typeof setTimeout> | null = null;
	let livePushEnabled = $state(true);

	function pushConfigLive(partial: DisplayConfig) {
		if (!livePushEnabled) return;
		if (livePushTimeout) clearTimeout(livePushTimeout);
		livePushTimeout = setTimeout(async () => {
			const targets = getTargets();
			await Promise.all(targets.map(id => store.pushConfig(id, partial)));
		}, 200);
	}

	function getTargets(): string[] {
		return selectedDevices.size > 0
			? [...selectedDevices]
			: store.devices.map(d => d.deviceId);
	}

	// Actions
	async function handlePushScene() {
		const targets = getTargets();
		if (targets.length === store.devices.length && store.devices.length > 0) {
			await store.broadcastScene(sceneLocation, sceneWeather);
		} else {
			await Promise.all(targets.map(id => store.pushScene(id, sceneLocation, sceneWeather)));
		}
	}

	async function handlePushMode() {
		const targets = getTargets();
		const payload = pushMode === 'video' ? videoUrl : undefined;
		await Promise.all(targets.map(id => store.pushMode(id, pushMode, payload)));
	}

	async function handlePushConfig() {
		const targets = getTargets();
		const config: DisplayConfig = {
			altitude: cfgAltitude,
			timeOfDay: cfgTimeOfDay,
			flightSpeed: cfgFlightSpeed,
			cloudDensity: cfgCloudDensity,
			nightLightIntensity: cfgNightLightIntensity,
			syncToRealTime: cfgSyncToRealTime,
			showClouds: cfgShowClouds,
		};
		await Promise.all(targets.map(id => store.pushConfig(id, config)));
	}

	function toggleSelectAll() {
		if (selectedDevices.size === store.devices.length) {
			selectedDevices = new Set();
		} else {
			selectedDevices = new Set(store.devices.map(d => d.deviceId));
		}
	}

	function toggleDevice(id: string) {
		const next = new Set(selectedDevices);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedDevices = next;
	}

	function formatUptime(seconds: number): string {
		if (seconds < 60) return `${Math.floor(seconds)}s`;
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		return `${h}h ${m}m`;
	}

	function timeSince(timestamp: number): string {
		const diff = (Date.now() - timestamp) / 1000;
		if (diff < 10) return 'just now';
		if (diff < 60) return `${Math.floor(diff)}s ago`;
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		return `${Math.floor(diff / 3600)}h ago`;
	}

	const onlineCount = $derived(store.devices.filter(d => d.online).length);
	const totalCount = $derived(store.devices.length);

	const WEATHER_OPTIONS: WeatherType[] = ['clear', 'cloudy', 'rain', 'overcast', 'storm'];
	const MODE_OPTIONS: { value: DisplayMode; label: string }[] = [
		{ value: 'flight', label: 'Flight Sim' },
		{ value: 'screensaver', label: 'Screensaver' },
		{ value: 'video', label: 'Video' },
	];
</script>

<div class="dashboard">
	<!-- Header -->
	<header class="header">
		<div class="header-left">
			<h1>Aero Admin</h1>
			<span class="subtitle">Fleet Management</span>
		</div>
		<div class="header-right">
			<span class="connection-badge" class:online={store.connectionState === 'connected'}>
				{store.connectionState === 'connected' ? store.transportType.toUpperCase() : 'Disconnected'}
			</span>
			<span class="device-count">
				{onlineCount}/{totalCount} online
			</span>
		</div>
	</header>

	<!-- Health Status Bar -->
	{#if store.fleetHealth.total > 0 || store.alerts.length > 0}
		<div class="health-bar">
			<div class="health-stats">
				<span class="health-stat">
					<span class="health-dot online"></span>
					{store.fleetHealth.online} online
				</span>
				<span class="health-stat">
					<span class="health-dot offline"></span>
					{store.fleetHealth.offline} offline
				</span>
				<span class="health-stat">
					Avg FPS: <strong>{store.fleetHealth.avgFps}</strong>
				</span>
				{#if store.serverUptime > 0}
					<span class="health-stat server-uptime">
						Server: {Math.floor(store.serverUptime / 3600)}h {Math.floor((store.serverUptime % 3600) / 60)}m
					</span>
				{/if}
			</div>
			{#if store.alerts.length > 0}
				<div class="alerts">
					{#each store.alerts as alert}
						<span class="alert-badge" class:error={alert.level === 'error'} class:warning={alert.level === 'warning'}>
							{alert.message}
						</span>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<div class="content">
		<!-- Control Panel -->
		<aside class="controls">
			<section class="control-section">
				<h3>Scene</h3>
				<label>
					<span>Location</span>
					<select bind:value={sceneLocation}>
						{#each LOCATIONS as loc (loc.id)}
							<option value={loc.id}>{loc.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>Weather</span>
					<select bind:value={sceneWeather}>
						{#each WEATHER_OPTIONS as w (w)}
							<option value={w}>{w[0].toUpperCase() + w.slice(1)}</option>
						{/each}
					</select>
				</label>
				<button class="btn btn-primary" onclick={handlePushScene}>
					Push Scene {selectedDevices.size > 0 ? `(${selectedDevices.size})` : '(All)'}
				</button>
			</section>

			<section class="control-section">
				<h3>Mode</h3>
				<div class="mode-buttons">
					{#each MODE_OPTIONS as opt (opt.value)}
						<button
							class="btn btn-mode"
							class:active={pushMode === opt.value}
							onclick={() => pushMode = opt.value}
						>
							{opt.label}
						</button>
					{/each}
				</div>
				{#if pushMode === 'video'}
					<input
						type="url"
						placeholder="Video URL..."
						bind:value={videoUrl}
						class="input"
					/>
				{/if}
				<button class="btn btn-secondary" onclick={handlePushMode}>
					Push Mode {selectedDevices.size > 0 ? `(${selectedDevices.size})` : '(All)'}
				</button>
			</section>

			<section class="control-section">
				<h3>
					Display Config
					<label class="live-toggle">
						<input type="checkbox" bind:checked={livePushEnabled} />
						<span>Live</span>
					</label>
				</h3>
				<label>
					<div class="slider-header">
						<span>Altitude</span>
						<span class="slider-value">{altitudeLabel}</span>
					</div>
					<input type="range" min="5000" max="48000" step="1000" bind:value={cfgAltitude}
						oninput={() => pushConfigLive({ altitude: cfgAltitude })} class="range" />
				</label>
				<label>
					<div class="slider-header">
						<span>Time of Day</span>
						<span class="slider-value">{timeLabel}</span>
					</div>
					<input type="range" min="0" max="24" step="0.25" bind:value={cfgTimeOfDay}
						oninput={() => pushConfigLive({ timeOfDay: cfgTimeOfDay })} class="range" />
				</label>
				<label>
					<div class="slider-header">
						<span>Flight Speed</span>
						<span class="slider-value">{speedLabel}</span>
					</div>
					<input type="range" min="0.1" max="5" step="0.1" bind:value={cfgFlightSpeed}
						oninput={() => pushConfigLive({ flightSpeed: cfgFlightSpeed })} class="range" />
				</label>
				<label>
					<div class="slider-header">
						<span>Cloud Density</span>
						<span class="slider-value">{cloudLabel}</span>
					</div>
					<input type="range" min="0" max="1" step="0.05" bind:value={cfgCloudDensity}
						oninput={() => pushConfigLive({ cloudDensity: cfgCloudDensity })} class="range" />
				</label>
				<label>
					<div class="slider-header">
						<span>Night Lights</span>
						<span class="slider-value">{nightLabel}</span>
					</div>
					<input type="range" min="0" max="5" step="0.1" bind:value={cfgNightLightIntensity}
						oninput={() => pushConfigLive({ nightLightIntensity: cfgNightLightIntensity })} class="range" />
				</label>
				<label>
					<div class="slider-header">
						<span>Quality</span>
						<span class="slider-value">{cfgQualityMode}</span>
					</div>
					<select bind:value={cfgQualityMode} onchange={() => pushConfigLive({ qualityMode: cfgQualityMode })} class="select">
						<option value="performance">Performance (Pi/Raspberry)</option>
						<option value="balanced">Balanced (default)</option>
						<option value="ultra">Ultra (high-end)</option>
					</select>
				</label>
				<div class="toggle-row">
					<label class="toggle-label">
						<input type="checkbox" bind:checked={cfgSyncToRealTime}
							onchange={() => pushConfigLive({ syncToRealTime: cfgSyncToRealTime })} />
						<span>Sync to Real Time</span>
					</label>
					<label class="toggle-label">
						<input type="checkbox" bind:checked={cfgShowClouds}
							onchange={() => pushConfigLive({ showClouds: cfgShowClouds })} />
						<span>Show Clouds</span>
					</label>
				</div>
				<button class="btn btn-primary" onclick={handlePushConfig}>
					Push All Config {selectedDevices.size > 0 ? `(${selectedDevices.size})` : '(All)'}
				</button>
			</section>

			<section class="control-section">
				<h3>Bulk</h3>
				<button class="btn btn-outline" onclick={toggleSelectAll}>
					{selectedDevices.size === store.devices.length && store.devices.length > 0
						? 'Deselect All'
						: 'Select All'}
				</button>
			</section>
		</aside>

		<!-- Device Grid -->
		<main class="grid-area">
			{#if store.devices.length === 0}
				<div class="empty-state">
					<p class="empty-title">No devices registered</p>
					<p class="empty-desc">
						{store.connectionState === 'connected'
							? 'Start a display instance — it will auto-register here.'
							: 'Waiting for server connection...'}
					</p>
				</div>
			{:else}
				<div class="device-grid">
					{#each store.devices as device (device.deviceId)}
						{@const selected = selectedDevices.has(device.deviceId)}
						<button
							class="device-card"
							class:online={device.online}
							class:offline={!device.online}
							class:selected
							onclick={() => toggleDevice(device.deviceId)}
						>
							<div class="card-header">
								<span class="status-dot" class:online={device.online}></span>
								<span class="hostname">{device.hostname || device.deviceId.slice(0, 8)}</span>
							</div>

							<div class="card-body">
								<div class="stat">
									<span class="stat-label">Location</span>
									<span class="stat-value">{device.currentLocation || '—'}</span>
								</div>
								<div class="stat">
									<span class="stat-label">Mode</span>
									<span class="stat-value">{device.currentMode || '—'}</span>
								</div>
								<div class="stat-row">
									<div class="stat">
										<span class="stat-label">FPS</span>
										<span class="stat-value" class:fps-warn={device.fps < 30} class:fps-good={device.fps >= 30}>
											{device.fps > 0 ? device.fps.toFixed(0) : '—'}
										</span>
									</div>
									<div class="stat">
										<span class="stat-label">Uptime</span>
										<span class="stat-value">{device.uptime > 0 ? formatUptime(device.uptime) : '—'}</span>
									</div>
								</div>
							</div>

							<div class="card-footer">
								<span class="last-seen">
									{device.online ? 'Active' : `Last: ${timeSince(device.lastSeen)}`}
								</span>
								{#if selected}
									<span class="selected-badge">Selected</span>
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</main>
	</div>
</div>

<style>
	.dashboard {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	/* Header */
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 24px;
		background: #16181d;
		border-bottom: 1px solid #27272a;
	}

	.header-left {
		display: flex;
		align-items: baseline;
		gap: 12px;
	}

	h1 {
		font-size: 20px;
		font-weight: 700;
		color: #fafafa;
	}

	.subtitle {
		font-size: 13px;
		color: #71717a;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.connection-badge {
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 12px;
		background: #7f1d1d;
		color: #fca5a5;
	}

	.connection-badge.online {
		background: #14532d;
		color: #86efac;
	}

	.device-count {
		font-size: 13px;
		color: #a1a1aa;
	}

	/* Health bar */
	.health-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 24px;
		background: #1a1c23;
		border-bottom: 1px solid #27272a;
		gap: 16px;
		flex-wrap: wrap;
	}

	.health-stats {
		display: flex;
		align-items: center;
		gap: 20px;
	}

	.health-stat {
		font-size: 12px;
		color: #a1a1aa;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.health-stat strong {
		color: #e4e4e7;
	}

	.health-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.health-dot.online { background: #22c55e; }
	.health-dot.offline { background: #ef4444; }

	.server-uptime {
		color: #52525b;
	}

	.alerts {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.alert-badge {
		font-size: 11px;
		padding: 3px 8px;
		border-radius: 4px;
	}

	.alert-badge.error {
		background: #7f1d1d;
		color: #fca5a5;
	}

	.alert-badge.warning {
		background: #713f12;
		color: #fde68a;
	}

	/* Content layout */
	.content {
		display: flex;
		flex: 1;
		overflow: hidden;
	}

	/* Controls sidebar */
	.controls {
		width: 280px;
		min-width: 280px;
		background: #16181d;
		border-right: 1px solid #27272a;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 24px;
		overflow-y: auto;
	}

	.control-section h3 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #71717a;
		margin-bottom: 12px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.live-toggle {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		color: #52525b;
		text-transform: none;
		letter-spacing: normal;
		margin-bottom: 0;
		cursor: pointer;
	}

	.live-toggle input {
		width: 12px;
		height: 12px;
		accent-color: #22c55e;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 10px;
	}

	label span {
		font-size: 12px;
		color: #a1a1aa;
	}

	select, .input {
		background: #0f1117;
		border: 1px solid #27272a;
		color: #e4e4e7;
		border-radius: 6px;
		padding: 8px 10px;
		font-size: 13px;
		width: 100%;
	}

	select:focus, .input:focus {
		outline: none;
		border-color: #3b82f6;
	}

	.mode-buttons {
		display: flex;
		gap: 6px;
		margin-bottom: 10px;
	}

	.btn {
		padding: 8px 14px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 500;
		border: none;
		transition: background 0.15s, opacity 0.15s;
	}

	.btn:hover { opacity: 0.85; }

	.btn-primary {
		background: #2563eb;
		color: white;
		width: 100%;
	}

	.btn-secondary {
		background: #27272a;
		color: #e4e4e7;
		width: 100%;
	}

	.btn-outline {
		background: transparent;
		border: 1px solid #3f3f46;
		color: #a1a1aa;
		width: 100%;
	}

	.btn-mode {
		flex: 1;
		background: #1e1e24;
		color: #71717a;
		padding: 6px 8px;
		font-size: 12px;
	}

	.btn-mode.active {
		background: #1e3a5f;
		color: #93c5fd;
	}

	/* Range sliders */
	.slider-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.slider-value {
		font-size: 12px;
		color: #93c5fd;
		font-variant-numeric: tabular-nums;
	}

	.range {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: #27272a;
		outline: none;
		cursor: pointer;
	}

	.range::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #3b82f6;
		cursor: pointer;
		border: 2px solid #1e3a5f;
	}

	.range::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #3b82f6;
		cursor: pointer;
		border: 2px solid #1e3a5f;
	}

	/* Toggles */
	.toggle-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 10px;
	}

	.toggle-label {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 8px;
		margin-bottom: 0;
		cursor: pointer;
	}

	.toggle-label input[type="checkbox"] {
		width: 16px;
		height: 16px;
		accent-color: #3b82f6;
		cursor: pointer;
	}

	/* Grid area */
	.grid-area {
		flex: 1;
		padding: 24px;
		overflow-y: auto;
	}

	.device-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 16px;
	}

	/* Device card */
	.device-card {
		background: #16181d;
		border: 1px solid #27272a;
		border-radius: 10px;
		padding: 16px;
		text-align: left;
		transition: border-color 0.15s, box-shadow 0.15s;
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
	}

	.device-card:hover {
		border-color: #3f3f46;
	}

	.device-card.selected {
		border-color: #3b82f6;
		box-shadow: 0 0 0 1px #3b82f6;
	}

	.device-card.offline {
		opacity: 0.55;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #ef4444;
		flex-shrink: 0;
	}

	.status-dot.online {
		background: #22c55e;
	}

	.hostname {
		font-weight: 600;
		font-size: 14px;
		color: #fafafa;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.stat {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.stat-row {
		display: flex;
		gap: 16px;
	}

	.stat-row .stat {
		flex: 1;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
	}

	.stat-label {
		font-size: 11px;
		color: #71717a;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.stat-value {
		font-size: 13px;
		color: #d4d4d8;
	}

	.fps-good { color: #86efac; }
	.fps-warn { color: #fbbf24; }

	.card-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-top: 8px;
		border-top: 1px solid #1e1e24;
	}

	.last-seen {
		font-size: 11px;
		color: #52525b;
	}

	.selected-badge {
		font-size: 10px;
		padding: 2px 8px;
		border-radius: 8px;
		background: #1e3a5f;
		color: #93c5fd;
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		min-height: 400px;
		gap: 8px;
	}

	.empty-title {
		font-size: 18px;
		font-weight: 600;
		color: #a1a1aa;
	}

	.empty-desc {
		font-size: 14px;
		color: #52525b;
	}
</style>
