<script lang="ts">
	import { RestAdminStore } from '$lib/fleet/rest-admin.svelte';
	import { startPeerSync } from '$lib/fleet/peer-sync.svelte';
	import { config } from '$lib/model/config-tree.svelte';
	import { formatTime, formatUptime } from '$lib/utils';
	import { fanOut } from '$lib/fleet/fan-out';
	import AtmosphereControls from '$lib/shell/panel/AtmosphereControls.svelte';
	import LightingControls from '$lib/shell/panel/LightingControls.svelte';
	import { WEATHER_TYPES, DISPLAY_MODES } from '$lib/types';
	import type { LocationId, WeatherType, DisplayMode } from '$lib/types';
	import { LOCATIONS } from '$content/locations';
	import { onDestroy } from 'svelte';
	import {
		listBindings,
		saveBinding,
		deleteBinding,
		getDeviceFingerprint,
		resolveBinding,
		type DeviceRole,
		type DeviceBinding,
	} from '$lib/fleet/parallax.svelte';

	// Admin is a view into the global config rune. Slider sliders bind directly
	// to `config.*` (module-scope $state — single instance per process). A $effect
	// inside startPeerSync watches those fields and POSTs PATCH /api/config to
	// every peer in `store.peers`, so edits propagate without an explicit push.
	//
	// Scene-level state (location/weather/altitude/time/flightSpeed) stays in
	// local `scene` state because it's a one-shot command ("go there"), not an
	// ambient config value. The "Push Scene" button dispatches on demand.
	const store = new RestAdminStore();
	const stopPeerSync = startPeerSync(store);
	onDestroy(() => { stopPeerSync(); store.destroy(); });

	// Selection state
	let selectedDevices = $state<Set<string>>(new Set());
	let pushMode = $state<DisplayMode>('flight');
	let videoUrl = $state('');

	// One-shot scene builder — what to command devices to be (not ambient config).
	// Shadow state is justified here because admin authors a DRAFT before pushing;
	// the device's actual location/time/weather is elsewhere (its own simulation).
	let scene = $state({
		location: 'dallas' as LocationId,
		weather: 'clear' as WeatherType,
		altitude: 35000,
		timeOfDay: 12,
		flightSpeed: 1.0,
		syncToRealTime: true,
	});

	// Derived display labels for scene sliders
	const altitudeLabel = $derived(`${(scene.altitude / 1000).toFixed(0)}k ft`);
	const timeLabel = $derived(formatTime(scene.timeOfDay));
	const speedLabel = $derived(`${scene.flightSpeed.toFixed(1)}x`);

	function getTargets(): string[] {
		return selectedDevices.size > 0
			? [...selectedDevices]
			: store.devices.map(d => d.deviceId);
	}

	// OTA update — trigger each device's own aero-updater.service now rather
	// than waiting up to 15 min for its timer. Unlike the scene/mode pushes,
	// this one reports: a device that 503s (AERO_ADMIN_TOKEN unset) or is
	// unreachable would otherwise look identical to a successful update, since
	// the expected outcome is "device goes offline for a minute" either way.
	let updateResult = $state<{ ok: number; failed: string[] } | null>(null);
	let updating = $state(false);

	async function handleUpdateNow() {
		const targets = getTargets();
		if (targets.length === 0 || updating) return;
		updating = true;
		updateResult = null;
		try {
			// store.triggerUpdate hits the device's /api/update DIRECTLY — the
			// server that actually spawns aero-updater.service.
			//
			// This used to POST {type:'update'} to /api/command instead, which
			// relays through SSE to that Pi's BROWSER, which then calls its own
			// /api/update. That path needs the kiosk tab alive and subscribed,
			// and the browser is the least reliable relay imaginable during an
			// update that restarts the app under it. It also reported success
			// for "message accepted", not "updater started". triggerUpdate
			// already existed for this and was dead code.
			updateResult = await fanOut(targets, async (id) => {
				const { ok, detail } = await store.triggerUpdate(id);
				// fanOut counts a throw as failure, so a refusal must throw or an
				// unreachable Pi reports as updated.
				if (!ok) throw new Error(detail ?? 'update failed');
			});
		} finally {
			updating = false;
		}
	}

	// Actions — push results
	let pushResult = $state<{ ok: number; failed: string[] } | null>(null);

	async function handlePushScene() {
		const targets = getTargets();
		if (targets.length === 0) return;
		pushResult = null;
		try {
			// One code path for 1..N targets: broadcastScene() was the same
			// per-peer POSTs under Promise.all, but one rejecting peer failed
			// the whole report (ok: 0 with 2 of 3 applied). fanOut attributes
			// success/failure per target.
			pushResult = await fanOut(targets, (id) =>
				store.pushScene(id, scene.location, scene.weather));
		} catch (e) { pushResult = { ok: 0, failed: [String(e)] }; }
	}

	async function handlePushMode() {
		const targets = getTargets();
		if (targets.length === 0) return;
		let payload: string | undefined;
		if (pushMode === 'video' && videoUrl) {
			try { const u = new URL(videoUrl); if (!['http:', 'https:'].includes(u.protocol)) return; } catch { return; }
			payload = videoUrl;
		}
		pushResult = null;
		try {
			pushResult = await fanOut(targets, (id) => store.pushMode(id, pushMode, payload));
		} catch (e) { pushResult = { ok: 0, failed: [String(e)] }; }
	}

	async function handlePushScene_Full() {
		const targets = getTargets();
		if (targets.length === 0) return;
		const patch = {
			altitude: scene.altitude,
			timeOfDay: scene.timeOfDay,
			flightSpeed: scene.flightSpeed,
			syncToRealTime: scene.syncToRealTime,
			weather: scene.weather,
		};
		pushResult = null;
		try {
			pushResult = await fanOut(targets, (id) => store.pushSceneFull(id, patch));
		} catch (e) { pushResult = { ok: 0, failed: [String(e)] }; }
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

	function timeSince(timestamp: number): string {
		const diff = (Date.now() - timestamp) / 1000;
		if (diff < 10) return 'just now';
		if (diff < 60) return `${Math.floor(diff)}s ago`;
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		return `${Math.floor(diff / 3600)}h ago`;
	}

	const onlineCount = $derived(store.devices.filter(d => d.online).length);
	const totalCount = $derived(store.devices.length);

	// Live digital clock
	let clockNow = $state(new Date());
	$effect(() => {
		const timer = setInterval(() => { clockNow = new Date(); }, 1000);
		return () => clearInterval(timer);
	});
	const clockDisplay = $derived(
		clockNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
	);

	// FPS badge — best available: fleet health avg or live from device grid
	const fpsBadge = $derived(
		store.fleetHealth.avgFps > 0 ? `${store.fleetHealth.avgFps.toFixed(0)} fps` : '— fps'
	);

	// Device temps — polled from heartbeat endpoint, merged into cards
	let deviceTemps = $state<Record<string, number>>({});
	$effect(() => {
		const poll = async () => {
			try {
				const res = await fetch('/api/fleet/heartbeat?summary');
				if (!res.ok) return;
				const data = await res.json();
				// Store per-device temp from heartbeat summary
				if (data.devices) {
					const temps: Record<string, number> = {};
					for (const d of data.devices) {
						if (d.deviceId && d.temp != null) temps[d.deviceId] = d.temp;
					}
					deviceTemps = temps;
				}
			} catch { /* heartbeat endpoint may not be available */ }
		};
		poll();
		const timer = setInterval(poll, 30000);
		return () => clearInterval(timer);
	});

	// Derived from the const-array SSOTs in $lib/types, not re-listed. A hand
	// written copy silently goes stale the day a weather type or display mode is
	// added: the kiosk's own WeatherPicker already iterates WEATHER_TYPES, so the
	// admin would offer a different set than the device it is driving.
	const WEATHER_OPTIONS: readonly WeatherType[] = WEATHER_TYPES;
	const MODE_LABELS: Record<DisplayMode, string> = {
		flight: 'Flight Sim',
		screensaver: 'Screensaver',
		video: 'Video',
	};
	// Record<DisplayMode, string> is exhaustive-checked, so adding a mode to
	// DISPLAY_MODES is a compile error here until it gets a label.
	const MODE_OPTIONS: { value: DisplayMode; label: string }[] =
		DISPLAY_MODES.map((value) => ({ value, label: MODE_LABELS[value] }));

	// ─── Device Bindings (SWA corridor Day 5) ─────────────────────────────────
	// Persistent fingerprint → (role, groupId) map. Admin edits this locally in
	// the browser running the admin panel — each physical display's binding is
	// authored by visiting /admin on that device. Also reflects this admin's
	// own current binding so the operator can sanity-check which pane they're on.
	const ROLE_OPTIONS: DeviceRole[] = ['solo', 'left', 'center', 'right'];
	let bindings = $state<Array<{ fingerprint: string; binding: DeviceBinding }>>([]);
	let myFingerprint = $state('');
	let myBinding = $state<DeviceBinding>({ role: 'solo', groupId: 'default' });

	// Form state for "assign this device" form.
	let formRole = $state<DeviceRole>('solo');
	let formGroup = $state('default');

	function refreshBindings() {
		if (typeof window === 'undefined') return;
		myFingerprint = getDeviceFingerprint();
		myBinding = resolveBinding();
		bindings = listBindings();
		formRole = myBinding.role;
		formGroup = myBinding.groupId;
	}

	function handleSaveMyBinding() {
		handleSetBinding(myFingerprint, formRole, formGroup);
		refreshBindings();
	}

	function handleSetBinding(fp: string, role: DeviceRole, groupId: string) {
		if (!groupId.trim()) return;
		saveBinding(fp, { role, groupId: groupId.trim() });
		refreshBindings();
	}

	function handleDeleteBinding(fp: string) {
		deleteBinding(fp);
		refreshBindings();
	}
</script>

<div class="dashboard">
	<!-- Header -->
	<header class="header">
		<div class="header-left">
			<h1>Aero Admin</h1>
			<span class="subtitle">Fleet Management</span>
		</div>
		<div class="header-right">
			<span class="fps-badge" class:good={store.fleetHealth.avgFps >= 30}>{fpsBadge}</span>
			<span class="clock-display">{clockDisplay}</span>
			<span class={['connection-badge', store.connectionState === 'connected' && 'online']}>
				{store.connectionState === 'connected' ? 'REST' : store.connectionState}
			</span>
			<span class="device-count">
				{onlineCount}/{totalCount} online
			</span>
		</div>
	</header>

	{#if store.fleetHealth.total > 0 || store.alerts.length > 0}
		<div class="health-bar">
			<div class="health-stats">
				<span class="health-stat"><span class="health-dot online"></span>{store.fleetHealth.online} online</span>
				<span class="health-stat"><span class="health-dot offline"></span>{store.fleetHealth.offline} offline</span>
				<span class="health-stat">Avg FPS: <strong>{store.fleetHealth.avgFps}</strong></span>
				{#if store.serverUptime > 0}
					<span class="health-stat server-uptime">Server: {Math.floor(store.serverUptime / 3600)}h {Math.floor((store.serverUptime % 3600) / 60)}m</span>
				{/if}
			</div>
			{#if store.alerts.length > 0}
				<div class="alerts">
					{#each store.alerts as alert (alert.device + '|' + alert.message)}
						<span class={['alert-badge', alert.level === 'error' && 'error', alert.level === 'warning' && 'warning']}>
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
				<h3>Location + Weather</h3>
				<label>
					<span>Location</span>
					<select bind:value={scene.location}>
						{#each LOCATIONS as loc (loc.id)}
							<option value={loc.id}>{loc.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>Weather</span>
					<select bind:value={scene.weather}>
						{#each WEATHER_OPTIONS as w (w)}
							<option value={w}>{w[0].toUpperCase() + w.slice(1)}</option>
						{/each}
					</select>
				</label>
				<button class="btn btn-primary" onclick={handlePushScene}>
					Fly There {selectedDevices.size > 0 ? `(${selectedDevices.size})` : '(All)'}
				</button>
			</section>

			<section class="control-section">
				<h3>Mode</h3>
				<div class="mode-buttons">
					{#each MODE_OPTIONS as opt (opt.value)}
						<button
							class={['btn', 'btn-mode', pushMode === opt.value && 'active']}
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
					Ambient <span class="hint-muted">— auto-syncs to fleet</span>
				</h3>
				<!-- Shared components with device SidePanel. They bind directly to the
				     module-scope config rune — editing here is identical to editing
				     on-device. peer-sync (above) propagates to peers. -->
				<AtmosphereControls />
				<LightingControls />
				<label>
					<div class="slider-header">
						<span>Quality</span>
						<span class="slider-value">{config.world.qualityMode}</span>
					</div>
					<select bind:value={config.world.qualityMode} class="select">
						<option value="performance">Performance (Pi/Raspberry)</option>
						<option value="balanced">Balanced (default)</option>
						<option value="ultra">Ultra (high-end)</option>
					</select>
				</label>
				<label class="toggle-label">
					<input type="checkbox" bind:checked={config.world.showClouds} />
					<span>Show Clouds</span>
				</label>
			</section>

			<section class="control-section">
				<h3>Scene — one-shot push</h3>
				<label>
					<div class="slider-header">
						<span>Altitude</span>
						<span class="slider-value">{altitudeLabel}</span>
					</div>
					<input type="range" min="5000" max="48000" step="1000" bind:value={scene.altitude} class="range" />
				</label>
				<label>
					<div class="slider-header">
						<span>Time of Day</span>
						<span class="slider-value">{timeLabel}</span>
					</div>
					<input type="range" min="0" max="24" step="0.25" bind:value={scene.timeOfDay} class="range" />
				</label>
				<label>
					<div class="slider-header">
						<span>Flight Speed</span>
						<span class="slider-value">{speedLabel}</span>
					</div>
					<input type="range" min="0.1" max="5" step="0.1" bind:value={scene.flightSpeed} class="range" />
				</label>
				<label class="toggle-label">
					<input type="checkbox" bind:checked={scene.syncToRealTime} />
					<span>Sync to Real Time</span>
				</label>
				<button class="btn btn-primary" onclick={handlePushScene_Full}>
					Push Scene {selectedDevices.size > 0 ? `(${selectedDevices.size})` : '(All)'}
				</button>
				{#if pushResult}
					<p class="update-result" class:has-failures={pushResult.failed.length > 0}>
						{pushResult.ok} pushed{pushResult.failed.length ? `, ${pushResult.failed.length} failed` : ''}
						{#if pushResult.failed.length}
							<span class="update-failed">{pushResult.failed.join(' · ')}</span>
						{/if}
					</p>
				{/if}
			</section>

			<section class="control-section">
				<h3>Bulk</h3>
				<button class="btn btn-outline" onclick={toggleSelectAll}>
					{selectedDevices.size === store.devices.length && store.devices.length > 0
						? 'Deselect All'
						: 'Select All'}
				</button>
			</section>

			<section class="control-section">
				<h3>Software</h3>
				<p class="section-caption">
					Pulls the CI-approved <code>release</code> branch, rebuilds on the device and restarts.
					Devices go offline ~1 min; confirm by their commit chip changing.
				</p>
				<button class="btn btn-secondary" onclick={handleUpdateNow} disabled={updating}>
					{updating ? 'Triggering…' : `Update Now ${selectedDevices.size > 0 ? `(${selectedDevices.size})` : '(All)'}`}
				</button>
				{#if updateResult}
					<p class="update-result" class:has-failures={updateResult.failed.length > 0}>
						{updateResult.ok} triggered{updateResult.failed.length ? `, ${updateResult.failed.length} failed` : ''}
						{#if updateResult.failed.length}
							<span class="update-failed">{updateResult.failed.join(' · ')}</span>
						{/if}
					</p>
				{/if}
			</section>

			<section class="control-section">
				<h3>Device Bindings</h3>
				<div class="bindings-my">
					<p class="bindings-caption">This device</p>
					<code class="bindings-fp" title={myFingerprint}>{myFingerprint}</code>
					<div class="bindings-form">
						<select bind:value={formRole} class="select">
							{#each ROLE_OPTIONS as r (r)}
								<option value={r}>{r}</option>
							{/each}
						</select>
						<input type="text" class="input" bind:value={formGroup} placeholder="groupId" />
						<button class="btn btn-secondary" onclick={handleSaveMyBinding}>Save</button>
					</div>
					<p class="bindings-hint">
						Current: <strong>{myBinding.role}</strong> / <strong>{myBinding.groupId}</strong>
						<br /><span class="muted">Applies on next playground load. Visit /admin on each pane to bind.</span>
					</p>
				</div>
				{#if bindings.length > 0}
					<p class="bindings-caption">Known bindings (this browser)</p>
					<ul class="bindings-list">
						{#each bindings as entry (entry.fingerprint)}
							<li class={['bindings-row', entry.fingerprint === myFingerprint && 'me']}>
								<code class="bindings-fp-small" title={entry.fingerprint}>{entry.fingerprint.slice(0, 8)}</code>
								<select
									class="select"
									value={entry.binding.role}
									onchange={(e) => handleSetBinding(entry.fingerprint, (e.currentTarget as HTMLSelectElement).value as DeviceRole, entry.binding.groupId)}
								>
									{#each ROLE_OPTIONS as r (r)}
										<option value={r}>{r}</option>
									{/each}
								</select>
								<input
									type="text"
									class="input input-sm"
									value={entry.binding.groupId}
									onchange={(e) => handleSetBinding(entry.fingerprint, entry.binding.role, (e.currentTarget as HTMLInputElement).value)}
								/>
								<button
									class="btn-x"
									aria-label="Delete binding"
									onclick={() => handleDeleteBinding(entry.fingerprint)}
								>✕</button>
							</li>
						{/each}
					</ul>
				{/if}
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
							class={['device-card', device.online ? 'online' : 'offline', selected && 'selected']}
							onclick={() => toggleDevice(device.deviceId)}
						>
							<div class="card-header">
								<span class={['status-dot', device.online && 'online']}></span>
								<span class="hostname">{device.hostname || device.deviceId.slice(0, 8)}</span>
								{#if device.commit}
									<span class="commit-chip" title="running commit">{device.commit}</span>
								{/if}
							</div>

							<div class="card-body">
								<div class="stat">
									<span class="stat-label">Location</span>
									<span class="stat-value">{device.currentLocation || '—'}</span>
								</div>
								<div class="stat">
									<span class="stat-label">Temp</span>
									<span class="stat-value">{deviceTemps[device.deviceId] != null ? `${deviceTemps[device.deviceId].toFixed(0)}°C` : '—'}</span>
								</div>
								<div class="stat">
									<span class="stat-label">Mode</span>
									<span class="stat-value">{device.currentMode || '—'}</span>
								</div>
								<div class="stat-row">
									<div class="stat">
										<span class="stat-label">FPS</span>
										<span class={['stat-value', device.fps < 30 ? 'fps-warn' : 'fps-good']}>
											{device.fps > 0 ? device.fps.toFixed(0) : '—'}
										</span>
									</div>
									<div class="stat">
										<span class="stat-label">Uptime</span>
										<span class="stat-value">{device.uptime > 0 ? formatUptime(device.uptime) : '—'}</span>
									</div>
								</div>
							</div>

							{#if device.errorCount}
								<div class="error-strip" title={device.lastErrors?.join('\n') ?? ''}>
									⚠ {device.errorCount} error{device.errorCount === 1 ? '' : 's'}
									{#if device.lastErrors?.length}
										<span class="error-last">· {device.lastErrors[device.lastErrors.length - 1]}</span>
									{/if}
								</div>
							{/if}

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

	.fps-badge {
		font-size: 12px;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 12px;
		background: #27272a;
		color: #a1a1aa;
		font-family: ui-monospace, monospace;
	}
	.fps-badge.good {
		background: #14532d;
		color: #86efac;
	}

	.clock-display {
		font-size: 13px;
		font-family: ui-monospace, monospace;
		color: #d4d4d8;
		letter-spacing: 0.5px;
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

	.hint-muted {
		font-size: 10px;
		color: #52525b;
		text-transform: none;
		letter-spacing: normal;
		font-weight: 400;
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

	/* Hardening surface — running-commit chip + error strip */
	.commit-chip {
		margin-left: auto;
		font-family: ui-monospace, monospace;
		font-size: 0.65rem;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		background: rgba(148, 163, 184, 0.15);
		color: #94a3b8;
	}
	.error-strip {
		margin: 0.35rem 0 0;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		background: rgba(248, 113, 113, 0.12);
		color: #fca5a5;
		font-size: 0.7rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.error-last { opacity: 0.75; }
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

	/* Device bindings (SWA corridor) */
	.bindings-my {
		background: #0f1117;
		border: 1px solid #27272a;
		border-radius: 6px;
		padding: 10px;
		margin-bottom: 12px;
	}
	.bindings-caption {
		font-size: 10px;
		color: #71717a;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 6px;
	}
	.section-caption {
		font-size: 11px;
		line-height: 1.45;
		color: #71717a;
		margin: 0 0 8px;
	}
	.section-caption code {
		font-size: 10.5px;
		color: #a1a1aa;
	}
	.update-result {
		font-size: 11px;
		color: #4ade80;
		margin: 8px 0 0;
	}
	.update-result.has-failures {
		color: #fbbf24;
	}
	.update-failed {
		display: block;
		font-size: 10.5px;
		color: #71717a;
		margin-top: 3px;
		word-break: break-word;
	}
	.bindings-fp {
		display: inline-block;
		font-size: 11px;
		color: #93c5fd;
		background: #111827;
		padding: 2px 6px;
		border-radius: 3px;
		margin-bottom: 8px;
		font-family: ui-monospace, Menlo, monospace;
	}
	.bindings-form {
		display: flex;
		gap: 6px;
		margin-bottom: 8px;
	}
	.bindings-form .select { flex: 0 0 80px; padding: 6px 8px; font-size: 12px; }
	.bindings-form .input { flex: 1; padding: 6px 8px; font-size: 12px; }
	.bindings-form .btn { flex: 0 0 auto; padding: 6px 12px; font-size: 12px; }
	.bindings-hint { font-size: 11px; color: #71717a; margin: 0; }
	.bindings-hint strong { color: #e4e4e7; }
	.bindings-hint .muted { color: #52525b; }
	.bindings-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.bindings-row {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.bindings-row.me {
		outline: 1px solid #1e3a5f;
		border-radius: 4px;
		padding: 2px;
	}
	.bindings-fp-small {
		font-size: 10px;
		color: #93c5fd;
		font-family: ui-monospace, Menlo, monospace;
		flex: 0 0 60px;
	}
	.bindings-row .select { flex: 0 0 70px; padding: 4px 6px; font-size: 11px; }
	.input-sm { padding: 4px 6px; font-size: 11px; flex: 1; min-width: 0; }
	.btn-x {
		background: transparent;
		border: 1px solid #3f3f46;
		color: #71717a;
		border-radius: 4px;
		width: 22px;
		height: 22px;
		cursor: pointer;
		font-size: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.btn-x:hover { border-color: #7f1d1d; color: #fca5a5; }
</style>
