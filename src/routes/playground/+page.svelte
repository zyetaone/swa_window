<script lang="ts">
	/**
	 * Playground — MapLibre scene lab (app-shell mode).
	 *
	 * End-to-end map, no window frame. Blind overlay pulls down over the
	 * full viewport. HUD chip-bar at bottom-left. Right-side drawer hides
	 * the dev tuning controls behind a toggle so the app-surface feels
	 * clean by default.
	 */

	import { untrack } from 'svelte';
	import type { SkyState } from '$lib/types';
	import { LOCATIONS, LOCATION_MAP } from '$lib/locations';
	import { WEATHER_EFFECTS } from '$lib/constants';
	import { getSkyState, nightFactor, clamp } from '$lib/utils';
	import { MotionEngine } from '$lib/camera/motion.svelte';
	// Local playground config
	import { playgroundCameraConfig as cameraConfig, playgroundDirectorConfig as directorConfig } from './lib/motion-config';
	import Weather from '$lib/atmosphere/weather/Weather.svelte';
	import AeroViewport from './AeroViewport.svelte';
	import { PALETTES, PALETTE_ENTRIES } from './palettes';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// Module-level singleton — survives SvelteKit navigation. Acceptable for a
	// scene lab route; if route-lifecycle cleanup is ever needed, migrate to
	// createContext/getContext pattern.
	import { pg, pgTick, pgCycleLocation, pgApplyRemoteLocation, pgHeadingOffsetDeg } from './lib/playground-state.svelte';
	import { isGroupLeader, shouldApplyDirectorDecision } from './lib/corridor.svelte';
	import { useBlind } from '$lib/shell/use-blind.svelte';
	import { LOCATION_IDS } from '$lib/locations';
	import { isV2, type ServerMessageV2 } from '$lib/fleet/protocol';
	import { isValidWeather } from '$lib/types';
	import { resolveFleetUrl } from '$lib/fleet/url';
	import PlaygroundHud from './components/PlaygroundHud.svelte';
	import PlaygroundDrawer from './components/PlaygroundDrawer.svelte';

	// ─── State ───────────────────────────────────────────────────────────────
	let mapLat = $state(25.2);
	let mapLon = $state(55.3);

	const motion = new MotionEngine();
	let simTime = $state(0);

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

	function cancelBoostRamp() {
		if (boostRampId !== null) {
			cancelAnimationFrame(boostRampId);
			boostRampId = null;
		}
	}

	function rampSpeed(from: number, to: number, durationMs: number) {
		cancelBoostRamp();
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

	function handleMapTap() {
		pgCycleLocation();
	}

	function handlePointerUp() {
		if (pressTimer !== null) {
			clearTimeout(pressTimer);
			pressTimer = null;
			handleMapTap();
			return;
		}
		if (isBoosting) {
			isBoosting = false;
			rampSpeed(pg.planeSpeed, BASE_SPEED, RAMP_DOWN_MS);
		}
	}

	function handlePointerCancel() {
		if (pressTimer !== null) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
		if (isBoosting) {
			isBoosting = false;
			rampSpeed(pg.planeSpeed, BASE_SPEED, RAMP_DOWN_MS);
		}
	}

	// ─── Blind (production composable) ───────────────────────────────────────
	// Long-press (≥400ms, no horizontal pan) → 3× drag speed + amber inner glow.
	const blind = useBlind(
		{
			get blindOpen() { return pg.blindOpen; },
			set blindOpen(v: boolean) { pg.blindOpen = v; },
			flight: { isTransitioning: false },
		},
		{
			longPress: {
				enabled: true,
				thresholdMs: 400,
				speedMultiplier: 3.0,
				releaseMs: 300,
			},
		},
	);

	// ─── Derived Camera ──────────────────────────────────────────────────────
	const currentLocation = $derived(LOCATION_MAP.get(pg.activeLocation) ?? LOCATIONS[0]);

	// Passenger window: looks 90° left of heading. Pitch responds to altitude
	// relative to cloud deck — below clouds (descending) you look UP more (lower pitch),
	// above clouds (climbing) you look DOWN more (higher pitch). Creates the
	// "descend through clouds, climb back above" holding pattern feel.
	// Corridor pane: offset the bearing by the role's heading-delta so the
	// three panes look "through" the same flight at slightly different angles.
	const paneHeadingOffset = $derived(pgHeadingOffsetDeg());
	const viewBearing = $derived(
		(pg.heading - 90 + paneHeadingOffset + motion.motionOffsetX * 1.5 + 360) % 360,
	);
	const cloudDeckBias = $derived((pg.altitude - 28000) / 8000 * 4); // ±4° based on altitude vs cloud deck
	const viewPitch = $derived(Math.max(58, Math.min(84, 72 + pg.pitchBias + cloudDeckBias + motion.motionOffsetY * 2.5)));

	// Snap map center when location changes (orbital drift takes over after)
	$effect(() => {
		const loc = LOCATION_MAP.get(pg.activeLocation);
		if (loc) {
			mapLat = loc.lat;
			mapLon = loc.lon;
		}
	});

	const skyState = $derived<SkyState>(getSkyState(pg.timeOfDay));
	const nf = $derived(nightFactor(pg.timeOfDay));
	const weatherFx = $derived(WEATHER_EFFECTS[pg.weather]);
	const windAngle = $derived(weatherFx.windAngle);
	const frostAmount = $derived(clamp((pg.altitude - 25000) / 15000, 0, 1));

	// Cloud-layer immersion — white fog overlay when flying through the deck.
	// Proximity to 28k ft cloud deck → 0 (clear) to 0.35 (near-whiteout).
	const cloudFogOpacity = $derived.by(() => {
		const dist = Math.abs(pg.altitude - 28000);
		if (dist > 6000) return 0;
		return (1 - dist / 6000) * 0.35;
	});

	const bgGradient = $derived.by(() => {
		if (pg.paletteName !== 'auto' && PALETTES[pg.paletteName]) {
			const p = PALETTES[pg.paletteName];
			return `linear-gradient(180deg, ${p.sky} 0%, ${p.horizon} 60%, ${p.fog} 100%)`;
		}
		switch (skyState) {
			case 'night': return 'linear-gradient(180deg, #05060f 0%, #0f1428 55%, #1a1f35 100%)';
			case 'dawn':  return 'linear-gradient(180deg, #1a1440 0%, #d96850 45%, #f0b070 70%, #d4a060 100%)';
			case 'dusk':  return 'linear-gradient(180deg, #1a1a3e 0%, #c06040 35%, #ddaa70 55%, #5a4a3a 100%)';
			default:      return 'linear-gradient(180deg, #4a90d9 0%, #7fb8ea 30%, #a4d4f4 55%, #b8c8a0 80%, #7a8860 100%)';
		}
	});

	// Atmospheric haze — screen-blended gradient that color-grades the entire
	// scene. ONLY applied for mood phases (dawn/dusk/night) — daytime uses
	// transparent so the CSS sky gradient and MapLibre atmosphere stay vivid.
	// The grey day-haze was washing the sky to a muddy grey-blue; removing it
	// restores the Variant B noon palette.
	const hazeGradient = $derived.by(() => {
		switch (skyState) {
			case 'night': return 'linear-gradient(180deg, rgba(20,28,50,0.55) 0%, rgba(10,16,35,0.4) 40%, rgba(5,8,18,0.3) 100%)';
			case 'dawn':  return 'linear-gradient(180deg, rgba(220,150,110,0.35) 0%, rgba(240,180,120,0.25) 45%, rgba(200,160,100,0.15) 100%)';
			case 'dusk':  return 'linear-gradient(180deg, rgba(200,110,90,0.4) 0%, rgba(180,90,70,0.3) 40%, rgba(100,60,50,0.2) 100%)';
			default:      return 'transparent';
		}
	});

	// ─── Corridor fleet (SWA Day 5) ──────────────────────────────────────────
	// Leader panes (solo/center) broadcast v2 director_decision when they
	// rotate location; follower panes (left/right) apply inbound decisions
	// scoped to their groupId at the shared wall-clock instant.
	let fleetWs = $state<WebSocket | null>(null);

	$effect(() => {
		if (typeof window === 'undefined') return;
		let closed = false;
		let ws: WebSocket | null = null;
		try {
			const { wsUrl } = resolveFleetUrl('display');
			ws = new WebSocket(wsUrl);
			ws.onopen = () => { if (!closed) fleetWs = ws; };
			ws.onclose = () => { fleetWs = null; };
			ws.onerror = () => { /* silent — LAN offline is fine in playground */ };
			ws.onmessage = (e) => {
				try {
					const parsed: unknown = JSON.parse(e.data);
					if (!isV2(parsed)) return;
					if (parsed.type !== 'director_decision') return;
					const msg = parsed as Extract<ServerMessageV2, { type: 'director_decision' }>;
					if (!shouldApplyDirectorDecision(pg.groupId, msg.groupId)) return;
					if (!LOCATION_IDS.has(msg.locationId)) return;
					const weather = isValidWeather(msg.weather) ? msg.weather : undefined;
					const delay = msg.transitionAtMs - Date.now();
					const apply = () => pgApplyRemoteLocation(msg.locationId, weather);
					if (delay < -50) apply();
					else setTimeout(apply, Math.max(0, delay));
				} catch { /* ignore malformed */ }
			};
		} catch { /* offline — ignore */ }
		return () => { closed = true; if (ws) ws.close(); fleetWs = null; };
	});

	// Broadcast once per activeLocation change — but only if this pane leads.
	let lastBroadcastLocation = '';
	$effect(() => {
		const loc = pg.activeLocation;
		if (!isGroupLeader(pg.role)) return;
		if (loc === lastBroadcastLocation) return;
		lastBroadcastLocation = loc;
		untrack(() => {
			const ws = fleetWs;
			if (!ws || ws.readyState !== WebSocket.OPEN) return;
			try {
				ws.send(JSON.stringify({
					v: 2,
					type: 'director_decision',
					scenarioId: 'playground-rotation',
					locationId: loc,
					weather: pg.weather,
					decidedAtMs: Date.now(),
					transitionAtMs: Date.now() + 2500,
					groupId: pg.groupId,
				}));
			} catch { /* offline */ }
		});
	});

	// Main RAF loop — invariant #3: untrack() wraps the entire tick body so
	// 60 Hz reactive reads don't build graph dependencies.
	// Three independent RAF loops run in the playground (page, MapLibreGlobe,
	// PhotoClouds). This is intentional — each component owns its animation
	// lifecycle independently, matching production's pattern where Window.svelte
	// RAF + scene effect timers run separately.
	$effect(() => {
		let raf: number;
		let last = performance.now();
		const loop = (now: number) => {
			const dt = Math.min((now - last) / 1000, 0.1); // cap to avoid teleport on tab-switch
			last = now;

			untrack(() => {
				simTime += dt;

				pgTick(dt, now, isBoosting, isGroupLeader(pg.role));

				if (pg.autoFly || isBoosting) {
					// Elliptical orbit: major/minor axes rotated by orbitTilt.
					// Each location segment gets a random ellipse shape + CW/CCW.
					const loc = currentLocation;
					const a = pg.orbitAngle;
					const t = pg.orbitTilt;
					const ex = pg.orbitMajor * Math.cos(a);
					const ey = pg.orbitMinor * Math.sin(a);
					// Rotate ellipse by tilt angle
					const latRad = loc.lat * Math.PI / 180;
					const cosT = Math.cos(t), sinT = Math.sin(t);
					mapLat = loc.lat + ex * cosT - ey * sinT;
					mapLon = loc.lon + (ex * sinT + ey * cosT) / Math.max(Math.cos(latRad), 0.2);
				}

				motion.tick(dt, {
					time: simTime,
					heading: pg.heading,
					altitude: pg.altitude,
					turbulenceLevel: pg.turbulenceLevel,
					weather: pg.weather,
					camera: cameraConfig,
					director: directorConfig,
					lat: currentLocation.lat,
					lon: currentLocation.lon,
					pitch: viewPitch,
					bankAngle: motion.bankAngle,
					skyState, nightFactor: nf, dawnDuskFactor: 0,
					locationId: pg.activeLocation,
					userAdjustingAltitude: false, userAdjustingTime: false, userAdjustingAtmosphere: false,
					cloudDensity: pg.density, cloudSpeed: pg.cloudSpeed, haze: 0,
				});
			});

			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	// Water post-process removed. Unified viewport handles rendering natively.


	const motionTransform = $derived.by(() => {
		// Turbulence coupling boosted from 0.08 → 0.25 so bumps are visible
		const turbY = motion.motionOffsetY * 0.25;
		const turbX = motion.motionOffsetX * 0.25;
		const turbRot = motion.motionOffsetY * 0.05;
		const breathY = motion.breathingOffset * cameraConfig.motion.breathingAmplitude;
		const bank = motion.bankAngle;
		const x = turbX + motion.engineVibeX;
		const y = turbY + breathY + motion.engineVibeY;
		return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${(turbRot + bank).toFixed(3)}deg)`;
	});
</script>

<div class="playground" class:boosting={isBoosting}>
	<button
		class="viewport-btn"
		style:background={bgGradient}
		onpointerdown={handlePointerDown}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerCancel}
		onpointerleave={handlePointerCancel}
		type="button"
	>
		<div
			class="globe-pane"
			style:transform={motionTransform}
			style:--flight-pitch="{viewPitch}deg"
			style:--flight-bank="{motion.bankAngle}deg"
			style:--flight-heading="{pg.heading}deg"
			style:--turbulence-y={motion.motionOffsetY}
			style:--turbulence-x={motion.motionOffsetX}
		>
			<AeroViewport
				lat={mapLat}
				lon={mapLon}
				altitudeMeters={pg.altitude * 0.3048}
				headingDeg={viewBearing}
				pitchDeg={viewPitch}
			/>
		</div>


		<Weather rainOpacity={weatherFx.rainOpacity} {windAngle} {frostAmount} />

		<div class="atmo-haze" style:background={hazeGradient} aria-hidden="true"></div>
		<div class="horizon-line" aria-hidden="true"></div>

		<!-- Cloud-layer fog — white overlay when flying through the cloud deck.
		     Fades in as altitude approaches 28k ft, max 35% opacity. -->
		{#if cloudFogOpacity > 0.01}
			<div class="cloud-fog" style:opacity={cloudFogOpacity} aria-hidden="true"></div>
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
			aria-valuenow={Math.round(Math.abs(blind.dragY))}
			aria-valuemin={0}
			aria-valuemax={105}
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
	.playground {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: #0b0b0e;
		color: #eee;
		font-family: system-ui, -apple-system, sans-serif;
	}

	.viewport-btn {
		position: absolute;
		inset: 0;
		border: none;
		padding: 0;
		cursor: pointer;
		overflow: hidden;
	}

	.globe-pane {
		position: absolute;
		inset: -100px;
		will-change: transform;
		/* Smooth the 60 Hz turbulence + breathing RAF updates. 60ms = ~1 frame
		   at 60fps — enough to damp micro-jitter without perceptable lag. */
		transition: transform 60ms linear;
	}

	/* Cloud-layer fog — white whiteout when flying through cloud deck */
	.cloud-fog {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 6;
		background: radial-gradient(ellipse 120% 100% at 50% 40%,
			rgba(255, 255, 255, 0.95) 0%,
			rgba(240, 245, 255, 0.85) 40%,
			rgba(220, 230, 245, 0.6) 70%,
			rgba(200, 215, 235, 0.3) 100%
		);
		transition: opacity 1.5s ease;
	}

	/* Cloud floor — continuous white "sea of clouds" below the plane.
	   Gradient: transparent at top (sky) → white at horizon (~35%) → solid
	   white below horizon → transparent at very bottom (near ground).
	   z-index 3 = below CSS 3D clouds (z:5) but above terrain (z:0). */
	/* Cloud floor CSS gradient removed — replaced by FillLayer deck polygon
	   in VectorCloudLayer (MapLibre native, proper depth sorting). */

	.horizon-line {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 3px;
		background: linear-gradient(90deg, transparent 0%, rgba(200, 220, 255, 0.15) 20%, rgba(200, 220, 255, 0.2) 50%, rgba(200, 220, 255, 0.15) 80%, transparent 100%);
		pointer-events: none;
	}

	/* ─── Atmospheric haze — composite color grading overlay ─────────── */
	.atmo-haze {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 4;
		mix-blend-mode: screen;
		transition: background 2s ease;
	}

	/* ─── Blind overlay (production useBlind composable) ─────────────────── */
	.blind-clip {
		position: absolute;
		inset: 0;
		overflow: hidden;
		z-index: 15;
		pointer-events: none;
	}

	.blind-overlay {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(
				180deg,
				#efece6 0%,
				#e8e4dd 35%,
				#e1ddd5 65%,
				#d6d1c8 100%
			);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		padding: 0;
		pointer-events: auto;
		touch-action: none;
		box-shadow:
			inset 0 2px 4px rgba(255, 255, 255, 0.6),
			inset 0 -6px 12px rgba(0, 0, 0, 0.15);
		transition: box-shadow 180ms ease;
	}

	/* Long-press acceleration — SWA city-amber inner glow. 300ms CSS
	   transition tracks the composable's 300ms decel curve on release. */
	.blind-overlay.accelerated {
		box-shadow:
			inset 0 0 40px rgba(255, 184, 74, 0.3),
			inset 0 2px 4px rgba(255, 255, 255, 0.6),
			inset 0 -6px 12px rgba(0, 0, 0, 0.15);
	}

	.blind-slats {
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.12) 0px,
			rgba(255, 255, 255, 0.12) 2px,
			rgba(230, 227, 221, 0.55) 2px,
			rgba(220, 217, 211, 0.55) 10px,
			rgba(0, 0, 0, 0.12) 10px,
			rgba(0, 0, 0, 0.12) 11px
		);
		mask-image: linear-gradient(
			90deg,
			rgba(0, 0, 0, 0.75) 0%,
			rgba(0, 0, 0, 1) 20%,
			rgba(0, 0, 0, 1) 80%,
			rgba(0, 0, 0, 0.75) 100%
		);
	}

	/* Pull-tab handle — recessed rectangle with grip ridges + drop shadow. */
	.blind-overlay::after {
		content: "";
		position: absolute;
		bottom: 10%;
		left: 50%;
		width: 56px;
		height: 18px;
		transform: translateX(-50%);
		background:
			repeating-linear-gradient(
				180deg,
				transparent 0px,
				transparent 3px,
				rgba(0, 0, 0, 0.22) 3px,
				rgba(0, 0, 0, 0.22) 4px
			),
			linear-gradient(180deg, #d8d4cc 0%, #a89f92 100%);
		border-radius: 9px;
		box-shadow:
			0 2px 5px rgba(0, 0, 0, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.6),
			inset 0 -1px 0 rgba(0, 0, 0, 0.25);
	}

	/* First-view "drag me" hint — tab bobs down-and-up 3x to signal direction. */
	@keyframes handle-breathe {
		0%, 100% { transform: translateX(-50%) translateY(0); opacity: 0.9; }
		50%      { transform: translateX(-50%) translateY(4px); opacity: 1; }
	}

	.blind-overlay.discoverable::after {
		animation: handle-breathe 1.2s ease-in-out 3;
	}

	/* Three cascading chevrons below tab — reinforces pull direction. */
	.pull-hint {
		position: absolute;
		bottom: 3%;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		pointer-events: none;
		opacity: 0.55;
	}
	.chev {
		font-size: 14px;
		color: rgba(0, 0, 0, 0.35);
		animation: chev-cascade 1.6s ease-in-out infinite;
	}
	.chev-1 { animation-delay: 0.0s; }
	.chev-2 { animation-delay: 0.2s; }
	.chev-3 { animation-delay: 0.4s; }

	@keyframes chev-cascade {
		0%, 100% { opacity: 0.25; transform: translateY(0); }
		50%      { opacity: 0.85; transform: translateY(3px); }
	}

	/* ─── Boost visual cue ───────────────────────────────────────────────── */
	.playground.boosting .viewport-btn {
		box-shadow: inset 0 0 60px rgba(255, 210, 120, 0.15);
		transition: box-shadow 0.3s ease;
	}

	/* ─── Drawer toggle ──────────────────────────────────────────────────── */
	.drawer-toggle {
		position: absolute;
		top: 16px;
		right: 16px;
		z-index: 30;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: rgba(10, 10, 15, 0.94);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #eee;
		font-size: 18px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
	}
	.drawer-toggle:hover { 
		transform: scale(1.1); 
		background: rgba(255, 255, 255, 0.1); 
		border-color: rgba(255, 255, 255, 0.3);
		box-shadow: 0 0 15px rgba(255, 255, 255, 0.1);
	}
	.drawer-toggle.open { 
		transform: rotate(90deg) scale(0.9); 
		background: rgba(0, 0, 0, 0.85);
		border-color: rgba(255, 255, 255, 0.2);
	}

	/* ─── Palette bar ────────────────────────────────────────────────────── */
	.palette-bar {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		display: flex;
		gap: 8px;
		align-items: center;
		background: rgba(10, 10, 15, 0.45);
		border: 1px solid rgba(255, 255, 255, 0.12);
		padding: 8px 12px;
		border-radius: 20px;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
	}

	.palette-swatch {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 1.5px solid rgba(255, 255, 255, 0.25);
		cursor: pointer;
		position: relative;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		flex-shrink: 0;
		padding: 0;
	}
	.palette-swatch:hover {
		transform: scale(1.25) translateY(-2px);
		border-color: rgba(255, 255, 255, 0.5);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}
	.palette-swatch.active {
		border-color: #fff;
		transform: scale(1.15);
	}
	.swatch-ring {
		position: absolute;
		inset: -4px;
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.7);
		pointer-events: none;
	}
</style>
