<script lang="ts">
	import { RestAdminStore } from '$lib/fleet/rest-admin.svelte';
	import { startPeerSync } from '$lib/fleet/peer-sync.svelte';
	import { formatAltitudeFt, formatSpeedX, formatTime, formatUptime } from '$lib/utils';
	import { fanOut } from '$lib/fleet/fan-out';
	import { subscribeWallClock, wallClockNow, formatClock } from '$lib/shell/passenger/wall-clock.svelte';
	import AtmosphereControls from '$lib/shell/operator/panel/AtmosphereControls.svelte';
	import FlightControls from '$lib/shell/operator/panel/FlightControls.svelte';
	import LightingControls from '$lib/shell/operator/panel/LightingControls.svelte';
	import { WEATHER_TYPES, DISPLAY_MODES, DEVICE_ROLES } from '$lib/types';
	import type { LocationId, WeatherType, DisplayMode } from '$lib/types';
	import { LOCATIONS, isValidLocation } from '$content/locations';
	import { onDestroy, onMount } from 'svelte';
	import {
		listBindings,
		saveBinding,
		deleteBinding,
		getDeviceFingerprint,
		resolveBinding,
		type DeviceRole,
		type DeviceBinding,
	} from '$lib/fleet/parallax.svelte';
	import type { AssetInfo } from '$lib/server/bundle/assets';
	import {
		isAllowedMediaUrl,
		isRelativeAssetUrl,
		encodeSlideshowPayload,
		toAbsoluteMediaUrl,
		absolutizeMediaUrls,
		DEFAULT_SLIDESHOW_INTERVAL_SEC,
	} from '$lib/fleet/display-payload';

	// Admin reuses the same dual-tree panel controls as the kiosk SidePanel.
	// They write through usePanelConfig → applyConfigPatch (no AeroWindow).
	// startPeerSync watches PEER_SYNC_PATHS and PATCHes peers on change.
	//
	// Scene-level state (location/weather/altitude/time/flightSpeed) stays in
	// local `scene` state — one-shot "go there", not ambient config.
	const store = new RestAdminStore();
	const stopPeerSync = startPeerSync(store);
	onDestroy(() => { stopPeerSync(); store.destroy(); });

	// Selection state
	let selectedDevices = $state<Set<string>>(new Set());
	let pushMode = $state<DisplayMode>('flight');
	let videoUrl = $state('');
	/** Ordered slideshow image URLs (assets and/or external). */
	let slideUrls = $state<string[]>([]);
	let slideIntervalSec = $state(DEFAULT_SLIDESHOW_INTERVAL_SEC);
	let slideUrlDraft = $state('');
	let assets = $state.raw<AssetInfo[]>([]);

	const VIDEO_EXT = /\.(mp4|webm)$/i;
	const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
	const videoAssets = $derived(assets.filter((a) => VIDEO_EXT.test(a.filename)));
	const imageAssets = $derived(assets.filter((a) => IMAGE_EXT.test(a.filename)));
	const adminOrigin = $derived(typeof window !== 'undefined' ? window.location.origin : '');
	const usesRelativeAssets = $derived.by(() => {
		if (pushMode === 'video') return isRelativeAssetUrl(videoUrl);
		if (pushMode === 'screensaver') return slideUrls.some(isRelativeAssetUrl);
		return false;
	});

	async function refreshAssets() {
		try {
			const res = await fetch('/api/assets');
			if (!res.ok) return;
			const data = await res.json();
			assets = (data.assets ?? []) as AssetInfo[];
		} catch { /* assets optional offline */ }
	}

	function pickVideoAsset(url: string) {
		videoUrl = url;
	}

	function toggleSlideAsset(url: string) {
		if (slideUrls.includes(url)) {
			slideUrls = slideUrls.filter((u) => u !== url);
		} else {
			slideUrls = [...slideUrls, url];
		}
	}

	function addSlideUrlDraft() {
		const u = slideUrlDraft.trim();
		if (!isAllowedMediaUrl(u) || slideUrls.includes(u)) return;
		slideUrls = [...slideUrls, u];
		slideUrlDraft = '';
	}

	function removeSlideUrl(url: string) {
		slideUrls = slideUrls.filter((u) => u !== url);
	}

	function moveSlide(url: string, dir: -1 | 1) {
		const i = slideUrls.indexOf(url);
		if (i < 0) return;
		const j = i + dir;
		if (j < 0 || j >= slideUrls.length) return;
		const next = [...slideUrls];
		[next[i], next[j]] = [next[j], next[i]];
		slideUrls = next;
	}

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

	// Seed the picker from the first online device once — otherwise a
	// blind "Fly There" pushes the hardcoded default (Dallas) over whatever
	// the wall is actually showing. Operator edits win: once a picker is
	// touched, seeding stops.
	let sceneSeeded = $state(false);
	let sceneDirty = $state(false);
	$effect(() => {
		if (sceneSeeded || sceneDirty) return;
		// Prefer an online device; fall back to any that has EVER reported
		// (lastSeen > 0 skips placeholder rows the store seeds before the
		// first status poll, whose 'dubai' location is not real data).
		const withLoc =
			store.devices.find((d) => d.online && isValidLocation(d.currentLocation)) ??
			store.devices.find((d) => d.lastSeen > 0 && isValidLocation(d.currentLocation));
		if (withLoc) {
			scene.location = withLoc.currentLocation;
			sceneSeeded = true;
		}
	});

	// Derived display labels for scene sliders
	const altitudeLabel = $derived(formatAltitudeFt(scene.altitude, 0));
	const timeLabel = $derived(formatTime(scene.timeOfDay));
	const speedLabel = $derived(formatSpeedX(scene.flightSpeed));

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
		// Absolute-ify /api/assets paths against this admin origin so every Pi
		// fetches media from the host that holds the files (not its own empty store).
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
		let payload: string | undefined;
		if (pushMode === 'video') {
			const abs = toAbsoluteMediaUrl(videoUrl, origin);
			if (!isAllowedMediaUrl(abs)) {
				pushResult = { ok: 0, failed: ['video URL required (http(s) or /api/assets/…)'] };
				return;
			}
			payload = abs;
		} else if (pushMode === 'screensaver') {
			if (slideUrls.length === 0) {
				pushResult = { ok: 0, failed: ['add at least one slideshow image'] };
				return;
			}
			payload = encodeSlideshowPayload(absolutizeMediaUrls(slideUrls, origin), slideIntervalSec);
			if (JSON.parse(payload).urls.length === 0) {
				pushResult = { ok: 0, failed: ['no allowed slideshow URLs'] };
				return;
			}
		}
		// flight: no payload
		pushResult = null;
		try {
			pushResult = await fanOut(targets, (id) => store.pushMode(id, pushMode, payload));
			// Heartbeats are slow — re-poll status so Mode chips reflect the push.
			// Short delay lets devices apply set_mode before we read /api/status.
			await new Promise((r) => setTimeout(r, 400));
			await store.refreshStatus();
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

	// Live digital clock — shared module rather than a third private interval
	// (this one allocated a whole Date into $state every second). Seconds are
	// on here because an ops dashboard wants them; the kiosk's clock does not.
	$effect(() => subscribeWallClock());
	const clockDisplay = $derived(formatClock(wallClockNow(), true));

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
		screensaver: 'Slideshow',
		video: 'Video',
	};

	/** Pretty-print device.currentMode on cards (wire uses screensaver). */
	function formatDeviceMode(mode: string | undefined): string {
		if (!mode) return '—';
		if (mode === 'screensaver') return 'Slideshow';
		if (mode === 'video') return 'Video';
		if (mode === 'flight') return 'Flight';
		return mode;
	}
	// Record<DisplayMode, string> is exhaustive-checked, so adding a mode to
	// DISPLAY_MODES is a compile error here until it gets a label.
	const MODE_OPTIONS: { value: DisplayMode; label: string }[] =
		DISPLAY_MODES.map((value) => ({ value, label: MODE_LABELS[value] }));

	// ─── Device Bindings (SWA corridor Day 5) ─────────────────────────────────
	// Persistent fingerprint → (role, groupId) map. Admin edits this locally in
	// the browser running the admin panel — each physical display's binding is
	// authored by visiting /admin on that device. Also reflects this admin's
	// own current binding so the operator can sanity-check which pane they're on.
	// Derived from the DEVICE_ROLES SSOT with 'solo' pinned first (the default).
	const ROLE_OPTIONS: DeviceRole[] = ['solo', ...DEVICE_ROLES.filter(r => r !== 'solo')];
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
	onMount(() => {
		refreshBindings();
		void refreshAssets();
	});

	function handleSaveMyBinding() {
		// handleSetBinding already calls refreshBindings().
		handleSetBinding(myFingerprint, formRole, formGroup);
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
			<span
				class="fps-badge"
				class:good={store.fleetHealth.avgFps >= 30}
				class:warn={store.fleetHealth.avgFps > 0 && store.fleetHealth.avgFps < 30}
			>{fpsBadge}</span>
			<span class="clock-display">{clockDisplay}</span>
			<span class={['connection-badge', store.connectionState === 'connected' && 'online']}>
				{store.connectionState === 'connected' ? 'REST' : store.connectionState}
			</span>
		</div>
	</header>

	{#if store.fleetHealth.total > 0 || store.alerts.length > 0}
		<div class="health-bar">
			<div class="health-stats">
				<span class="health-stat"><span class="health-dot online"></span>{store.fleetHealth.online} online</span>
				<span class="health-stat"><span class="health-dot offline"></span>{store.fleetHealth.offline} offline</span>
				<span class="health-stat">Avg FPS: <strong>{store.fleetHealth.avgFps}</strong></span>
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
					<select bind:value={scene.location} onchange={() => (sceneDirty = true)}>
						{#each LOCATIONS as loc (loc.id)}
							<option value={loc.id}>{loc.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>Weather</span>
					<select bind:value={scene.weather} onchange={() => (sceneDirty = true)}>
						{#each WEATHER_OPTIONS as w (w)}
							<option value={w}>{w[0].toUpperCase() + w.slice(1)}</option>
						{/each}
					</select>
				</label>
				<button class="btn btn-secondary" onclick={handlePushScene}>
					Fly There {selectedDevices.size > 0 ? `(${selectedDevices.size})` : '(All)'}
				</button>
			</section>

			<section class="control-section">
				<h3>Mode</h3>
				<p class="section-caption">
					Flight = globe. Video = looped fullscreen. Slideshow = image playlist
					(screensaver). Upload media on <a href="/admin/content">Content</a>, then pick here.
					Asset paths are rewritten to absolute URLs against this admin host so every Pi can fetch them.
				</p>
				{#if usesRelativeAssets}
					<p class="media-warn">
						Devices must reach <code>{adminOrigin}</code> for these assets
						(or use absolute CDN/http URLs).
					</p>
				{/if}
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
					<label>
						<span>Video URL</span>
						<input
							type="url"
							placeholder="https://… or /api/assets/…"
							bind:value={videoUrl}
							class="input"
						/>
					</label>
					{#if videoAssets.length > 0}
						<p class="asset-hint">Installed videos — click to select</p>
						<div class="asset-grid">
							{#each videoAssets as a (a.filename)}
								<button
									type="button"
									class={['asset-chip', videoUrl === a.url && 'active']}
									onclick={() => pickVideoAsset(a.url)}
									title={a.filename}
								>
									{a.filename}
								</button>
							{/each}
						</div>
					{:else}
						<p class="asset-hint muted">No video assets yet — drop .mp4/.webm on Content.</p>
					{/if}
				{:else if pushMode === 'screensaver'}
					<label>
						<div class="slider-header">
							<span>Slide interval</span>
							<span class="slider-value">{slideIntervalSec}s</span>
						</div>
						<input
							type="range"
							min="3"
							max="60"
							step="1"
							bind:value={slideIntervalSec}
							class="range"
						/>
					</label>
					{#if imageAssets.length > 0}
						<p class="asset-hint">Installed images — click to toggle in playlist</p>
						<div class="asset-grid">
							{#each imageAssets as a (a.filename)}
								<button
									type="button"
									class={['asset-chip', slideUrls.includes(a.url) && 'active']}
									onclick={() => toggleSlideAsset(a.url)}
									title={a.filename}
								>
									{a.filename}
								</button>
							{/each}
						</div>
					{:else}
						<p class="asset-hint muted">No image assets yet — drop .png/.jpg/.webp on Content.</p>
					{/if}
					<div class="slide-url-row">
						<input
							type="url"
							placeholder="Add external image URL…"
							bind:value={slideUrlDraft}
							class="input"
							onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSlideUrlDraft(); } }}
						/>
						<button type="button" class="btn btn-secondary" onclick={addSlideUrlDraft}>Add</button>
					</div>
					{#if slideUrls.length > 0}
						<ol class="slide-list">
							{#each slideUrls as url, i (url)}
								<li>
									<span class="slide-idx">{i + 1}</span>
									<code class="slide-url" title={url}>{url}</code>
									<div class="slide-actions">
										<button type="button" class="icon-btn" onclick={() => moveSlide(url, -1)} disabled={i === 0} title="Up">↑</button>
										<button type="button" class="icon-btn" onclick={() => moveSlide(url, 1)} disabled={i === slideUrls.length - 1} title="Down">↓</button>
										<button type="button" class="icon-btn" onclick={() => removeSlideUrl(url)} title="Remove">×</button>
									</div>
								</li>
							{/each}
						</ol>
					{/if}
				{/if}

				<button class="btn btn-secondary" onclick={handlePushMode}>
					Push Mode {selectedDevices.size > 0 ? `(${selectedDevices.size})` : '(All)'}
				</button>
			</section>

			<section class="control-section">
				<h3>
					Ambient <span class="hint-muted">— auto-syncs to fleet</span>
				</h3>
				<!-- Same dual-tree panels as kiosk SidePanel. FlightControls
				     shows night-lit only (no AeroWindow → no speed/alt sliders).
				     usePanelConfig → applyConfigPatch; peer-sync fans out. -->
				<FlightControls />
				<AtmosphereControls />
				<LightingControls />
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
				<div class="grid-toolbar">
					<button class="btn btn-outline" onclick={toggleSelectAll}>
						{selectedDevices.size === store.devices.length && store.devices.length > 0
							? 'Deselect All'
							: 'Select All'}
					</button>
				</div>
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
									<span class="stat-value">{LOCATIONS.find((l) => l.id === device.currentLocation)?.name || device.currentLocation || '—'}</span>
								</div>
								<div class="stat">
									<span class="stat-label">Temp</span>
									<span class="stat-value">{deviceTemps[device.deviceId] != null ? `${deviceTemps[device.deviceId].toFixed(0)}°C` : '—'}</span>
								</div>
								<div class="stat">
									<span class="stat-label">Mode</span>
									<span
										class={[
											'stat-value',
											'mode-chip',
											device.currentMode && device.currentMode !== 'flight' && 'mode-media',
										]}
									>
										{formatDeviceMode(device.currentMode)}
									</span>
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
	:global(body) {
		margin: 0;
		background: var(--bg-base);
		color: var(--text);
		font-family: system-ui, -apple-system, sans-serif;
	}

	.dashboard {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--bg-base);
	}

	/* Header */
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 24px;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border);
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
		color: var(--muted);
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
		color: var(--error-text);
	}

	.connection-badge.online {
		background: #14532d;
		color: var(--ok-text);
	}

	.fps-badge {
		font-size: 12px;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 12px;
		background: var(--border);
		color: var(--text-dim);
		font-family: ui-monospace, monospace;
	}
	.fps-badge.good {
		background: #14532d;
		color: var(--ok-text);
	}
	.fps-badge.warn {
		background: #713f12;
		color: #fde68a;
	}

	.clock-display {
		font-size: 13px;
		font-family: ui-monospace, monospace;
		color: var(--muted);
		letter-spacing: 0.5px;
	}

	/* Health bar */
	.health-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 24px;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--border);
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
		color: var(--text-dim);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.health-stat strong {
		color: var(--text);
	}

	.health-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.health-dot.online { background: var(--ok); }
	.health-dot.offline { background: var(--error); }

	.alerts {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.alert-badge {
		font-size: 11px;
		padding: 3px 8px;
		border-radius: 4px;
		background: var(--border);
		color: var(--text-dim);
	}

	.alert-badge.error {
		background: #7f1d1d;
		color: var(--error-text);
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
		background: var(--bg-surface);
		border-right: 1px solid var(--border);
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 24px;
		overflow-y: auto;
	}

	.controls :global(h4) {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
		margin: 0 0 10px;
	}
	.controls :global(.control label),
	.controls :global(.toggle-container) {
		color: var(--text-dim);
		text-shadow: none;
	}
	.controls :global(.label-text) {
		text-shadow: none;
	}

	.control-section h3 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
		margin-bottom: 12px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.hint-muted {
		font-size: 10px;
		color: var(--muted);
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
		color: var(--text-dim);
	}

	select, .input {
		background: var(--bg-base);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 6px;
		padding: 8px 10px;
		font-size: 13px;
		width: 100%;
	}

	select:focus:not(:focus-visible), .input:focus:not(:focus-visible) {
		outline: none;
		border-color: var(--accent);
	}

	.btn:focus-visible,
	.device-card:focus-visible,
	.btn-x:focus-visible,
	select:focus-visible,
	.input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.mode-buttons {
		display: flex;
		gap: 6px;
		margin-bottom: 10px;
	}

	.media-warn {
		margin: 0 0 10px;
		padding: 8px 10px;
		font-size: 11px;
		line-height: 1.4;
		border-radius: 6px;
		background: #713f12;
		color: #fde68a;
	}
	.media-warn code {
		font-size: 10px;
		word-break: break-all;
	}

	.asset-hint {
		margin: 8px 0 6px;
		font-size: 11px;
		color: var(--text-dim);
	}
	.asset-hint.muted { opacity: 0.7; }
	.asset-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 10px;
	}
	.asset-chip {
		font-size: 11px;
		padding: 4px 8px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-dim);
		cursor: pointer;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.asset-chip.active {
		border-color: var(--accent);
		color: var(--text);
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.slide-url-row {
		display: flex;
		gap: 6px;
		margin: 8px 0;
	}
	.slide-url-row .input { flex: 1; }
	.slide-url-row .btn { width: auto; }
	.slide-list {
		list-style: none;
		margin: 0 0 10px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.slide-list li {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		padding: 4px 6px;
		border-radius: 4px;
		background: var(--bg-surface);
		border: 1px solid var(--border);
	}
	.slide-idx {
		opacity: 0.5;
		font-variant-numeric: tabular-nums;
		min-width: 1.2em;
	}
	.slide-url {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 10px;
		color: var(--text-dim);
	}
	.slide-actions { display: flex; gap: 2px; }
	.icon-btn {
		width: 22px;
		height: 22px;
		border: none;
		border-radius: 4px;
		background: var(--border);
		color: var(--text);
		cursor: pointer;
		font-size: 12px;
		line-height: 1;
	}
	.icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }

	.btn {
		padding: 8px 14px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 500;
		border: none;
		transition: background 0.15s, opacity 0.15s;
	}

	.btn:hover:not(:disabled) { opacity: 0.85; }

	.btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-primary {
		background: var(--primary);
		color: white;
		width: 100%;
	}

	.btn-secondary {
		background: var(--border);
		color: var(--text);
		width: 100%;
	}

	.btn-outline {
		background: transparent;
		border: 1px solid #3f3f46;
		color: var(--text-dim);
		width: 100%;
	}

	.btn-mode {
		flex: 1;
		background: #1e1e24;
		color: var(--muted);
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
		background: var(--border);
		outline: none;
		cursor: pointer;
	}

	.range::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--accent);
		cursor: pointer;
		border: 2px solid #1e3a5f;
	}

	.range::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--accent);
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
		accent-color: var(--accent);
		cursor: pointer;
	}

	/* Grid area */
	.grid-area {
		flex: 1;
		padding: 24px;
		overflow-y: auto;
	}

	.grid-toolbar {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 12px;
	}

	.grid-toolbar .btn {
		width: auto;
	}

	.device-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 16px;
	}

	/* Device card */
	.device-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
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
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}

	.device-card.offline .card-body,
	.device-card.offline .card-footer {
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
		background: var(--error);
		flex-shrink: 0;
	}

	.status-dot.online {
		background: var(--ok);
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
	}

	.stat-label {
		font-size: 11px;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.mode-chip.mode-media {
		color: #93c5fd;
		font-weight: 600;
		text-transform: capitalize;
	}

	.stat-value {
		font-size: 13px;
		color: #d4d4d8;
	}

	.fps-good { color: var(--ok-text); }

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
		color: var(--error-text);
		font-size: 0.7rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.error-last { opacity: 0.75; }
	.fps-warn { color: var(--warn); }

	.card-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-top: 8px;
		border-top: 1px solid #1e1e24;
	}

	.last-seen {
		font-size: 11px;
		color: var(--muted);
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
		color: var(--text-dim);
	}

	.empty-desc {
		font-size: 14px;
		color: var(--muted);
	}

	/* Device bindings (SWA corridor) */
	.bindings-my {
		background: var(--bg-base);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 10px;
		margin-bottom: 12px;
	}
	.bindings-caption {
		font-size: 10px;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 6px;
	}
	.section-caption {
		font-size: 11px;
		line-height: 1.45;
		color: var(--muted);
		margin: 0 0 8px;
	}
	.section-caption code {
		font-size: 10.5px;
		color: var(--text-dim);
	}
	.update-result {
		font-size: 11px;
		color: var(--ok-text);
		margin: 8px 0 0;
	}
	.update-result.has-failures {
		color: #fbbf24;
	}
	.update-failed {
		display: block;
		font-size: 10.5px;
		color: var(--muted);
		margin-top: 3px;
		word-break: break-word;
	}
	.bindings-fp {
		display: inline-block;
		font-size: 11px;
		color: #93c5fd;
		background: #1e1e24;
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
	.bindings-hint { font-size: 11px; color: var(--muted); margin: 0; }
	.bindings-hint strong { color: var(--text); }
	.bindings-hint .muted { color: var(--muted); }
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
	.bindings-row .select { flex: 0 0 70px; padding: 6px 8px; font-size: 12px; }
	.input-sm { padding: 6px 8px; font-size: 12px; flex: 1; min-width: 0; }
	.btn-x {
		background: transparent;
		border: 1px solid #3f3f46;
		color: var(--muted);
		border-radius: 4px;
		width: 22px;
		height: 22px;
		cursor: pointer;
		font-size: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.btn-x:hover { border-color: #7f1d1d; color: var(--error-text); }

	@media (max-width: 1100px) {
		.controls {
			width: 240px;
			min-width: 240px;
		}
	}
</style>
