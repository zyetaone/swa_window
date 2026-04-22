<script lang="ts">
	/**
	 * Playground — MapLibre scene lab (app-shell mode).
	 */

	import AeroViewport from './AeroViewport.svelte';
	import PlaygroundHud from './components/PlaygroundHud.svelte';
	import PlaygroundDrawer from './components/PlaygroundDrawer.svelte';
	import Weather from '$lib/atmosphere/weather/Weather.svelte';
	import { PALETTE_ENTRIES } from '$lib/simulation/palettes';
	import { pg, pgCycleLocation, pgApplyRemoteLocation, pgBgGradient, pgHazeGradient, pgCloudFogOpacity } from './lib/playground-state.svelte';
	import { isGroupLeader, shouldApplyDirectorDecision } from '$lib/fleet/parallax.svelte';
	import { useBlind } from '$lib/shell/use-blind.svelte';
	import { LOCATION_IDS } from '$lib/locations';
	import { isV2, type ServerMessageV2 } from '$lib/fleet/protocol';
	import { isValidWeather } from '$lib/types';
	import { resolveFleetUrl } from '$lib/fleet/url';
	import { WEATHER_EFFECTS } from '$lib/constants';
	import { clamp } from '$lib/utils';
	import 'maplibre-gl/dist/maplibre-gl.css';

	// ─── UI state ────────────────────────────────────────────────────────────
	let drawerOpen = $state(false);

	// ─── Long-press boost ────────────────────────────────────────────────────
	const BASE_SPEED = 1.0;
	const BOOST_SPEED = 3.0;
	const LONG_PRESS_MS = 250;
	const RAMP_UP_MS = 700;
	const RAMP_DOWN_MS = 500;

	let pressTimer = $state<number | null>(null);
	let boostRampId = $state<number | null>(null);
	let isBoosting = $state(false);

	function rampSpeed(from: number, to: number, durationMs: number) {
		if (boostRampId !== null) cancelAnimationFrame(boostRampId);
		const t0 = performance.now();
		const step = (now: number) => {
			const t = clamp((now - t0) / durationMs, 0, 1);
			pg.planeSpeed = from + (to - from) * (t * t * (3 - 2 * t));
			if (t < 1) boostRampId = requestAnimationFrame(step);
			else boostRampId = null;
		};
		boostRampId = requestAnimationFrame(step);
	}

	function handlePointerDown() {
		pressTimer = window.setTimeout(() => {
			pressTimer = null;
			isBoosting = true;
			rampSpeed(pg.planeSpeed, BOOST_SPEED, RAMP_UP_MS);
		}, LONG_PRESS_MS);
	}

	function handlePointerUp() {
		if (pressTimer !== null) {
			clearTimeout(pressTimer);
			pressTimer = null;
			pgCycleLocation();
			return;
		}
		if (isBoosting) {
			isBoosting = false;
			rampSpeed(pg.planeSpeed, BASE_SPEED, RAMP_DOWN_MS);
		}
	}

	function handlePointerCancel() {
		if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
		if (isBoosting) { isBoosting = false; rampSpeed(pg.planeSpeed, BASE_SPEED, RAMP_DOWN_MS); }
	}

	// ─── Blind (production composable) ───────────────────────────────────────
	const blind = useBlind(
		{
			get blindOpen() { return pg.blindOpen; },
			set blindOpen(v: boolean) { pg.blindOpen = v; },
			flight: { isTransitioning: false },
		},
		{
			longPress: { enabled: true, thresholdMs: 400, speedMultiplier: 3.0, releaseMs: 300 },
		},
	);

	// ─── Weather Effects ─────────────────────────────────────────────────────
	const weatherFx = $derived(WEATHER_EFFECTS[pg.weather]);
	const frostAmount = $derived(clamp((pg.altitude - 25000) / 15000, 0, 1));

	// ─── Corridor fleet sync ─────────────────────────────────────────────────
	let fleetWs = $state<WebSocket | null>(null);
	$effect(() => {
		if (typeof window === 'undefined') return;
		let closed = false, ws: WebSocket | null = null;
		try {
			const { wsUrl } = resolveFleetUrl('display');
			ws = new WebSocket(wsUrl);
			ws.onopen = () => { if (!closed) fleetWs = ws; };
			ws.onclose = () => { fleetWs = null; };
			ws.onmessage = (e) => {
				try {
					const parsed: unknown = JSON.parse(e.data);
					if (!isV2(parsed)) return;
					if (parsed.type !== 'director_decision') return;
					const msg = parsed as Extract<ServerMessageV2, { type: 'director_decision' }>;
					if (!shouldApplyDirectorDecision(pg.groupId, msg.groupId)) return;
					if (!LOCATION_IDS.has(msg.locationId)) return;
					const weather = isValidWeather(msg.weather) ? msg.weather : undefined;
					const apply = () => pgApplyRemoteLocation(msg.locationId, weather);
					const delay = msg.transitionAtMs - Date.now();
					if (delay < -50) apply(); else setTimeout(apply, Math.max(0, delay));
				} catch { /* ignore */ }
			};
		} catch { /* ignore offline */ }
		return () => { closed = true; if (ws) ws.close(); fleetWs = null; };
	});

	// Broadcast leader decisions
	let lastBroadcastLocation = '';
	$effect(() => {
		const loc = pg.activeLocation;
		if (!isGroupLeader(pg.role) || loc === lastBroadcastLocation) return;
		lastBroadcastLocation = loc;
		const ws = fleetWs;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		try {
			ws.send(JSON.stringify({
				v: 2, type: 'director_decision', scenarioId: 'playground-rotation',
				locationId: loc, weather: pg.weather, decidedAtMs: Date.now(),
				transitionAtMs: Date.now() + 2500, groupId: pg.groupId,
			}));
		} catch { /* ignore */ }
	});
</script>

<div class="playground" class:boosting={isBoosting}>
	<button
		class="viewport-btn"
		style:background={pgBgGradient}
		onpointerdown={handlePointerDown}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerCancel}
		onpointerleave={handlePointerCancel}
		type="button"
	>
		<div class="globe-pane">
			<AeroViewport {isBoosting} />
		</div>

		<Weather rainOpacity={weatherFx.rainOpacity} windAngle={weatherFx.windAngle} {frostAmount} />

		<div class="atmo-haze" style:background={pgHazeGradient} aria-hidden="true"></div>
		<div class="horizon-line" aria-hidden="true"></div>

		{#if pgCloudFogOpacity > 0.01}
			<div class="cloud-fog" style:opacity={pgCloudFogOpacity} aria-hidden="true"></div>
		{/if}
	</button>

	<div class="blind-clip" bind:this={blind.clipEl}>
		<div
			class={['blind-overlay', !pg.blindOpen && !blind.hasAnimated && 'discoverable', blind.accelerated && 'accelerated']}
			onanimationend={() => { blind.hasAnimated = true; }}
			onpointerdown={blind.onPointerDown}
			onpointermove={blind.onPointerMove}
			onpointerup={blind.onPointerUp}
			onkeydown={blind.onKeyDown}
			role="slider"
			tabindex={0}
			aria-label="Window blind — drag to open or close"
			style:transform={blind.transform}
			style:transition={blind.transition}
			style:pointer-events={pg.blindOpen ? 'none' : 'auto'}
		>
			<div class="blind-slats"></div>
			{#if !pg.blindOpen && !blind.hasAnimated}
				<div class="pull-hint" aria-hidden="true">
					<span class="chev chev-1">&#x25BC;</span>
					<span class="chev chev-2">&#x25BC;</span>
					<span class="chev chev-3">&#x25BC;</span>
				</div>
			{/if}
		</div>
	</div>

	<PlaygroundHud {isBoosting} />

	<div class="palette-bar" role="group" aria-label="Ambient environment">
		{#each PALETTE_ENTRIES as entry (entry.name)}
			<button
				class="palette-swatch"
				class:active={pg.paletteName === entry.name}
				style:background={entry.swatchColor}
				title={entry.label}
				onclick={() => pg.paletteName = entry.name}
			>
				{#if pg.paletteName === entry.name}
					<span class="swatch-ring"></span>
				{/if}
			</button>
		{/each}
	</div>

	<button
		class="drawer-toggle"
		class:open={drawerOpen}
		onclick={() => drawerOpen = !drawerOpen}
		aria-label="Toggle settings"
	>
		{drawerOpen ? '✕' : '⚙'}
	</button>

	<PlaygroundDrawer bind:drawerOpen />
</div>

<style>
	.playground { position: fixed; inset: 0; overflow: hidden; background: #0b0b0e; color: #eee; font-family: system-ui, sans-serif; }
	.viewport-btn { position: absolute; inset: 0; border: none; padding: 0; cursor: pointer; overflow: hidden; }
	.globe-pane { position: absolute; inset: -100px; transition: transform 60ms linear; }
	.cloud-fog {
		position: absolute; inset: 0; pointer-events: none; z-index: 6;
		background: radial-gradient(ellipse 120% 100% at 50% 40%, rgba(255,255,255,0.95) 0%, rgba(240,245,255,0.85) 40%, rgba(220,230,245,0.6) 70%, rgba(200,215,235,0.3) 100%);
		transition: opacity 1.5s ease;
	}
	.horizon-line { position: absolute; left: 0; right: 0; top: 50%; height: 3px; background: linear-gradient(90deg, transparent 0%, rgba(200,220,255,0.15) 20%, rgba(200,220,255,0.2) 50%, rgba(200,220,255,0.15) 80%, transparent 100%); pointer-events: none; }
	.atmo-haze { position: absolute; inset: 0; pointer-events: none; z-index: 4; mix-blend-mode: screen; transition: background 2s ease; }
	.blind-clip { position: absolute; inset: 0; overflow: hidden; z-index: 15; pointer-events: none; }
	.blind-overlay {
		position: absolute; inset: 0; background: linear-gradient(180deg, #efece6 0%, #e8e4dd 35%, #e1ddd5 65%, #d6d1c8 100%);
		cursor: pointer; display: flex; align-items: center; justify-content: center; border: none; padding: 0; pointer-events: auto; touch-action: none;
		box-shadow: inset 0 2px 4px rgba(255,255,255,0.6), inset 0 -6px 12px rgba(0,0,0,0.15); transition: box-shadow 180ms ease;
	}
	.blind-overlay.accelerated { box-shadow: inset 0 0 40px rgba(255,184,74,0.3), inset 0 2px 4px rgba(255,255,255,0.6), inset 0 -6px 12px rgba(0,0,0,0.15); }
	.blind-slats {
		position: absolute; inset: 0; background: repeating-linear-gradient(180deg, rgba(255,255,255,0.12) 0px, rgba(255,255,255,0.12) 2px, rgba(230,227,221,0.55) 2px, rgba(220,217,211,0.55) 10px, rgba(0,0,0,0.12) 10px, rgba(0,0,0,0.12) 11px);
		mask-image: linear-gradient(90deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,1) 20%, rgba(0,0,0,1) 80%, rgba(0,0,0,0.75) 100%);
	}
	.blind-overlay::after {
		content: ""; position: absolute; bottom: 10%; left: 50%; width: 56px; height: 18px; transform: translateX(-50%);
		background: repeating-linear-gradient(180deg, transparent 0px, transparent 3px, rgba(0,0,0,0.22) 3px, rgba(0,0,0,0.22) 4px), linear-gradient(180deg, #d8d4cc 0%, #a89f92 100%);
		border-radius: 9px; box-shadow: 0 2px 5px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -1px 0 rgba(0,0,0,0.25);
	}
	@keyframes handle-breathe { 0%, 100% { transform: translateX(-50%) translateY(0); opacity: 0.9; } 50% { transform: translateX(-50%) translateY(4px); opacity: 1; } }
	.blind-overlay.discoverable::after { animation: handle-breathe 1.2s ease-in-out 3; }
	.pull-hint { position: absolute; bottom: 3%; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; opacity: 0.55; }
	.chev { font-size: 14px; color: rgba(0,0,0,0.35); animation: chev-cascade 1.6s ease-in-out infinite; }
	.chev-1 { animation-delay: 0.0s; } .chev-2 { animation-delay: 0.2s; } .chev-3 { animation-delay: 0.4s; }
	@keyframes chev-cascade { 0%, 100% { opacity: 0.25; transform: translateY(0); } 50% { opacity: 0.85; transform: translateY(3px); } }
	.playground.boosting .viewport-btn { box-shadow: inset 0 0 60px rgba(255,210,120,0.15); transition: box-shadow 0.3s ease; }
	.drawer-toggle {
		position: absolute; top: 16px; right: 16px; z-index: 30; width: 44px; height: 44px; border-radius: 50%; background: rgba(10,10,15,0.94); border: 1px solid rgba(255,255,255,0.12); color: #eee; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s cubic-bezier(0.16,1,0.3,1); box-shadow: 0 4px 12px rgba(0,0,0,0.2);
	}
	.drawer-toggle:hover { transform: scale(1.1); background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.3); box-shadow: 0 0 15px rgba(255,255,255,0.1); }
	.drawer-toggle.open { transform: rotate(90deg) scale(0.9); background: rgba(0,0,0,0.85); border-color: rgba(255,255,255,0.2); }
	.palette-bar {
		position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 10; display: flex; gap: 8px; align-items: center; background: rgba(10,10,15,0.45); border: 1px solid rgba(255,255,255,0.12); padding: 8px 12px; border-radius: 20px; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 4px 20px rgba(0,0,0,0.25);
	}
	.palette-swatch { width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.25); cursor: pointer; position: relative; transition: all 0.2s cubic-bezier(0.16,1,0.3,1); flex-shrink: 0; padding: 0; }
	.palette-swatch:hover { transform: scale(1.25) translateY(-2px); border-color: rgba(255,255,255,0.5); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
	.palette-swatch.active { border-color: #fff; transform: scale(1.15); }
	.swatch-ring { position: absolute; inset: -4px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.7); pointer-events: none; }
</style>

