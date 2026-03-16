<script lang="ts">
	import { AdminStore } from '$lib/admin-store.svelte';
	import type { LocationId, WeatherType, DisplayMode } from '@zyeta/shared';
	import { LOCATIONS } from '@zyeta/shared';

	const store = new AdminStore();

	// Selection state
	let selectedDevices = $state<Set<string>>(new Set());
	let sceneLocation = $state<LocationId>('dallas');
	let sceneWeather = $state<WeatherType>('clear');
	let pushMode = $state<DisplayMode>('flight');
	let videoUrl = $state('');

	// Bulk select toggle
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

	// Actions
	async function handlePushScene() {
		const targets = selectedDevices.size > 0
			? [...selectedDevices]
			: store.devices.map(d => d.deviceId);

		if (targets.length === store.devices.length && store.devices.length > 0) {
			await store.broadcastScene(sceneLocation, sceneWeather);
		} else {
			await Promise.all(targets.map(id => store.pushScene(id, sceneLocation, sceneWeather)));
		}
	}

	async function handlePushMode() {
		const targets = selectedDevices.size > 0
			? [...selectedDevices]
			: store.devices.map(d => d.deviceId);
		const payload = pushMode === 'video' ? videoUrl : undefined;
		await Promise.all(targets.map(id => store.pushMode(id, pushMode, payload)));
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
			<span class="connection-badge" class:online={store.connected}>
				{store.connected ? 'Connected' : 'Disconnected'}
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
						{#each LOCATIONS as loc}
							<option value={loc.id}>{loc.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>Weather</span>
					<select bind:value={sceneWeather}>
						{#each WEATHER_OPTIONS as w}
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
					{#each MODE_OPTIONS as opt}
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
						{store.connected
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
