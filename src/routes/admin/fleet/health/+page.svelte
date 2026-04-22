<!--
	Admin fleet health dashboard.

	Renders one tile per device with the most recent heartbeat metrics:
	FPS, CPU temp, uptime, crash count, online/offline state.

	Polls /api/fleet/heartbeat every 5 s. No WebSocket — health data is
	append-only and already has server-side ring-buffer semantics, so
	polling is simpler and degrades gracefully across flaky networks.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { HeartbeatSample } from '$lib/fleet/heartbeat.svelte';

	interface FleetSummary {
		total: number;
		online: number;
		offline: number;
		avgFps: number;
		maxTempC: number;
		totalCrashes: number;
	}

	let samples = $state<HeartbeatSample[]>([]);
	let summary = $state<FleetSummary>({
		total: 0, online: 0, offline: 0, avgFps: 0, maxTempC: 0, totalCrashes: 0,
	});
	let error = $state<string | null>(null);
	const ONLINE_MS = 3 * 60_000;

	async function poll() {
		try {
			const [devs, sum] = await Promise.all([
				fetch('/api/fleet/heartbeat').then((r) => r.json()),
				fetch('/api/fleet/heartbeat?summary').then((r) => r.json()),
			]);
			samples = devs as HeartbeatSample[];
			summary = sum as FleetSummary;
			error = null;
		} catch (e) {
			error = (e as Error).message;
		}
	}

	poll();
	const interval = setInterval(poll, 5_000);
	onDestroy(() => clearInterval(interval));

	function formatUptime(sec: number): string {
		if (sec <= 0) return '-';
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		return `${h}h ${m}m`;
	}

	function isOnline(s: HeartbeatSample): boolean {
		return Date.now() - s.receivedAt < ONLINE_MS;
	}

	function tempColor(c: number): string {
		if (c >= 80) return '#ef4444';
		if (c >= 70) return '#f59e0b';
		return '#22c55e';
	}

	function fpsColor(fps: number): string {
		if (fps === 0) return '#6b7280';
		if (fps < 30) return '#ef4444';
		if (fps < 55) return '#f59e0b';
		return '#22c55e';
	}
</script>

<svelte:head>
	<title>Fleet Health · Aero Window</title>
</svelte:head>

<div class="page">
	<header>
		<h1>Fleet health</h1>
		<nav><a href="/admin">← Admin</a></nav>
	</header>

	{#if error}
		<p class="err">Error fetching heartbeats: {error}</p>
	{/if}

	<section class="summary">
		<div class="stat"><strong>{summary.online}</strong> / {summary.total} online</div>
		<div class="stat"><strong>{summary.offline}</strong> offline</div>
		<div class="stat"><strong>{summary.avgFps.toFixed(1)}</strong> avg fps</div>
		<div class="stat"><strong>{summary.maxTempC}°C</strong> max</div>
		<div class="stat"><strong>{summary.totalCrashes}</strong> crashes</div>
	</section>

	<section class="tiles">
		{#each samples as s (s.deviceId)}
			<article class="tile" class:offline={!isOnline(s)}>
				<header>
					<span class="id">{s.deviceId}</span>
					<span class="role">{s.role} · {s.groupId}</span>
				</header>
				<dl>
					<div><dt>FPS</dt><dd style:color={fpsColor(s.fps)}>{s.fps.toFixed(0)}</dd></div>
					<div><dt>Temp</dt><dd style:color={tempColor(s.temp)}>{s.temp}°C</dd></div>
					<div><dt>Uptime</dt><dd>{formatUptime(s.uptime)}</dd></div>
					<div><dt>Crashes</dt><dd>{s.crashCount}</dd></div>
				</dl>
				<footer>
					last heartbeat {Math.round((Date.now() - s.receivedAt) / 1000)}s ago
				</footer>
			</article>
		{:else}
			<p class="empty">No heartbeats received yet. Pi devices need AERO_ADMIN_URL set.</p>
		{/each}
	</section>
</div>

<style>
	.page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
		font: 14px/1.5 system-ui, sans-serif;
		color: #e5e7eb;
		background: #0b0f19;
		min-height: 100vh;
	}
	header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
	header h1 { font-size: 1.5rem; margin: 0; }
	header a { color: #60a5fa; text-decoration: none; }
	.err { background: #7f1d1d; padding: 0.75rem; border-radius: 4px; }
	.summary {
		display: flex;
		gap: 1.5rem;
		padding: 1rem 1.25rem;
		background: #1f2937;
		border-radius: 8px;
		margin-bottom: 1.5rem;
	}
	.stat strong { font-size: 1.25rem; color: #fff; }
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 1rem;
	}
	.tile {
		background: #1f2937;
		border-radius: 8px;
		padding: 1rem;
		border: 2px solid #22c55e;
	}
	.tile.offline { border-color: #6b7280; opacity: 0.6; }
	.tile header {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}
	.id { font-weight: 600; }
	.role { font-size: 0.8rem; color: #9ca3af; }
	dl { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin: 0; }
	dl > div { display: flex; justify-content: space-between; }
	dt { color: #9ca3af; }
	dd { margin: 0; font-weight: 600; }
	.tile footer { font-size: 0.75rem; color: #6b7280; margin-top: 0.75rem; }
	.empty { color: #9ca3af; grid-column: 1 / -1; text-align: center; padding: 2rem; }
</style>
