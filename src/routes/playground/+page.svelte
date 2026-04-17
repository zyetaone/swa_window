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
	import { ALL_MAPLIBRE_SOURCES, findSource } from './imagery';
	import { landmarksFor } from './lib/landmarks';
	import { MotionEngine } from '$lib/camera/motion.svelte';
	// Local playground config
	import { playgroundCameraConfig as cameraConfig, playgroundDirectorConfig as directorConfig } from './lib/motion-config';
	import CloudBlobs from '$lib/atmosphere/clouds/CloudBlobs.svelte';
	import Weather from '$lib/atmosphere/weather/Weather.svelte';
	import MapLibreGlobe from './MapLibreGlobe.svelte';
	import NightOverlay from './NightOverlay.svelte';
	import ThreeBillboards from './ThreeBillboards.svelte';
	import PhotoClouds from './PhotoClouds.svelte';
	import WebGLClouds from './WebGLClouds.svelte';
	import type maplibregl from 'maplibre-gl';
	import { PALETTES, PALETTE_ENTRIES } from './palettes';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// Module-level singleton — survives SvelteKit navigation. Acceptable for a
	// scene lab route; if route-lifecycle cleanup is ever needed, migrate to
	// createContext/getContext pattern.
	import { pg } from './lib/playground-state.svelte';
	import PlaygroundHud from './components/PlaygroundHud.svelte';
	import GlassOverlays from './components/GlassOverlays.svelte';
	import LensFlare from './components/LensFlare.svelte';
	import PlaygroundDrawer from './components/PlaygroundDrawer.svelte';

	// ─── State ───────────────────────────────────────────────────────────────
	let mapLat = $state(25.2);
	let mapLon = $state(55.3);

	const motion = new MotionEngine();
	let simTime = $state(0);

	// Map instance exposed from MapLibreGlobe
	let mapRef = $state<maplibregl.Map | undefined>(undefined);

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
		pg.cycleLocation();
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

	// ─── Blind drag ──────────────────────────────────────────────────────────
	let blindY = $state(0);
	let blindDragging = $state(false);
	let blindDragStart = 0;
	let blindDragStartY = 0;

	function handleBlindPointerDown(e: PointerEvent) {
		blindDragging = true;
		blindDragStart = e.clientY;
		blindDragStartY = blindY;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}
	function handleBlindPointerMove(e: PointerEvent) {
		if (!blindDragging) return;
		const dy = e.clientY - blindDragStart;
		const vh = window.innerHeight;
		blindY = clamp(blindDragStartY + (dy / vh) * 100, 0, 100);
	}
	function handleBlindPointerUp() {
		if (!blindDragging) return;
		blindDragging = false;
		blindY = blindY > 40 ? 100 : 0;
	}

	// ─── Derived Camera ──────────────────────────────────────────────────────
	const currentLocation = $derived(LOCATION_MAP.get(pg.activeLocation) ?? LOCATIONS[0]);

	// Passenger window: looks 90° left of heading. Pitch responds to altitude
	// relative to cloud deck — below clouds (descending) you look UP more (lower pitch),
	// above clouds (climbing) you look DOWN more (higher pitch). Creates the
	// "descend through clouds, climb back above" holding pattern feel.
	const viewBearing = $derived((pg.heading - 90 + motion.motionOffsetX * 1.5 + 360) % 360);
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

	const maplibreSrc = $derived(findSource(ALL_MAPLIBRE_SOURCES, pg.maplibreSource));
	const skyState = $derived<SkyState>(getSkyState(pg.timeOfDay));
	const nf = $derived(nightFactor(pg.timeOfDay));
	const weatherFx = $derived(WEATHER_EFFECTS[pg.weather]);
	const windAngle = $derived(weatherFx.windAngle);
	const frostAmount = $derived(clamp((pg.altitude - 25000) / 15000, 0, 1));

	// ── Lens Flare — tracks sun position on screen ─────────────────────
	const sunAzimuth = $derived((pg.timeOfDay * 15) % 360);

	// Signed bearing difference: negative = sun left, positive = sun right
	const sunBearingDiff = $derived.by(() => {
		return (sunAzimuth - viewBearing + 540) % 360 - 180;
	});

	// Intensity ramps as sun aligns with camera (within ±40°)
	const sunAlignment = $derived.by(() => {
		if (skyState === 'night') return 0;
		return clamp(1 - Math.abs(sunBearingDiff) / 40, 0, 1);
	});

	// Sun screen-space position (% from viewport edges):
	// X: bearing diff → horizontal offset (±40° maps to ±45% of viewport)
	// Y: sun elevation → vertical (noon=high, dawn/dusk=horizon line)
	const sunScreenX = $derived(clamp(50 + (sunBearingDiff / 40) * 45, 5, 95));
	const sunScreenY = $derived.by(() => {
		const hourAngle = (pg.timeOfDay - 12) * 15;
		const elevation = Math.cos(hourAngle * Math.PI / 180); // -1..1
		return clamp(45 - elevation * 30, 10, 70);
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
	// scene. Matches prod atmosphere/haze/effect.svelte per skyState.
	const hazeGradient = $derived.by(() => {
		switch (skyState) {
			case 'night': return 'linear-gradient(180deg, rgba(20,28,50,0.55) 0%, rgba(10,16,35,0.4) 40%, rgba(5,8,18,0.3) 100%)';
			case 'dawn':  return 'linear-gradient(180deg, rgba(220,150,110,0.35) 0%, rgba(240,180,120,0.25) 45%, rgba(200,160,100,0.15) 100%)';
			case 'dusk':  return 'linear-gradient(180deg, rgba(200,110,90,0.4) 0%, rgba(180,90,70,0.3) 40%, rgba(100,60,50,0.2) 100%)';
			default:      return 'linear-gradient(180deg, rgba(170,195,220,0.3) 0%, rgba(190,210,230,0.2) 50%, rgba(160,180,160,0.1) 100%)';
		}
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

				pg.tick(dt, now, isBoosting);

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
			<MapLibreGlobe
				bind:mapRef
				lat={mapLat}
				lon={mapLon}
				altitude={pg.altitude}
				pitch={viewPitch}
				bearing={viewBearing}
				imageryUrl={maplibreSrc.isPmtiles ? '' : maplibreSrc.url}
				imageryAttribution={maplibreSrc.attribution ?? ''}
				imageryMaxZoom={maplibreSrc.maxZoom ?? 14}
				pmtilesUrl={maplibreSrc.isPmtiles ? maplibreSrc.url : ''}
				showTerrain={pg.mlTerrain}
				showBuildings={pg.mlBuildings}
				showAtmosphere={pg.mlAtmosphere}
				nightFactor={nf}
				timeOfDay={pg.timeOfDay}
				paletteName={pg.paletteName}
				freeCam={pg.freeCam}
				showCityLights={pg.showCityLights}
				showLandmarks={pg.showLandmarks}
				locationId={pg.activeLocation}
				terrainExaggeration={1.5}
				lodMaxZoomLevels={pg.lodMaxZoomLevels}
				lodTileCountRatio={pg.lodTileCountRatio}
			/>
			{#if pg.showThreeBillboards && mapRef}
				<ThreeBillboards
					map={mapRef}
					locationId={pg.activeLocation}
					landmarks={landmarksFor(pg.activeLocation).features}
				/>
			{/if}
		</div>

		{#if pg.cloudRenderer === 'webgl'}
			<WebGLClouds
				density={pg.density}
				speed={pg.cloudSpeed}
				heading={pg.heading}
				altitude={pg.altitude}
				nightFactor={nf}
				weather={pg.weather}
				cloudScale={pg.cloudScale ?? 1.0}
			/>
		{:else if pg.cloudRenderer === 'svg'}
			<PhotoClouds
				density={pg.density}
				speed={pg.cloudSpeed}
				heading={pg.heading}
				altitude={pg.altitude}
				{windAngle}
				nightFactor={nf}
				weather={pg.weather}
				cloudScale={pg.cloudScale ?? 1.0}
				cloudSpread={pg.cloudSpread ?? 1.0}
				bankAngle={motion.bankAngle}
			/>
		{:else}
			<CloudBlobs density={pg.density} speed={pg.cloudSpeed} {skyState} heading={pg.heading} altitude={pg.altitude} {windAngle} />
		{/if}

		<NightOverlay nightFactor={nf} timeOfDay={pg.timeOfDay} skyState={skyState} viewBearing={viewBearing} />
		<Weather rainOpacity={weatherFx.rainOpacity} {windAngle} {frostAmount} />

		<div class="atmo-haze" style:background={hazeGradient} aria-hidden="true"></div>
		<div class="horizon-line" aria-hidden="true"></div>

		<LensFlare {sunAlignment} {skyState} sunX={sunScreenX} sunY={sunScreenY} />
		<!-- Airplane window glass overlays — fixed to "glass", don't move with turbulence.
		     Ported from prod shell/window/Glass.svelte. Creates depth illusion. -->
		<GlassOverlays bankAngle={motion.bankAngle} />
	</button>

	<div class="blind" class:dragging={blindDragging} style:transform={`translateY(${blindY - 100}%)`}>
		<div class="blind-surface"></div>
		<button
			class="blind-pull"
			onpointerdown={handleBlindPointerDown}
			onpointermove={handleBlindPointerMove}
			onpointerup={handleBlindPointerUp}
			onpointercancel={handleBlindPointerUp}
		>
			<div class="blind-pull-grip"></div>
			<div class="blind-pull-hint">{blindY > 50 ? '↑ pull up' : '↓ pull down'}</div>
		</button>
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

	/* ─── Blind overlay ──────────────────────────────────────────────────── */
	.blind {
		position: absolute;
		inset: 0;
		z-index: 15;
		pointer-events: none;
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.blind.dragging { transition: none; }

	.blind-surface {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, #d4c8a8 0%, #c4b898 50%, #b4a888 100%);
		background-image:
			repeating-linear-gradient(180deg, rgba(0, 0, 0, 0.03) 0, rgba(0, 0, 0, 0.03) 1px, transparent 1px, transparent 14px),
			linear-gradient(180deg, #d4c8a8, #b4a888);
		box-shadow: inset 0 -20px 40px rgba(0, 0, 0, 0.3);
	}

	.blind-pull {
		position: absolute;
		bottom: -28px;
		left: 50%;
		transform: translateX(-50%);
		width: 80px;
		height: 56px;
		background: transparent;
		border: none;
		padding: 0;
		cursor: grab;
		pointer-events: auto;
		touch-action: none;
	}
	.blind-pull:active { cursor: grabbing; }

	.blind-pull-grip {
		width: 40px;
		height: 6px;
		margin: 6px auto;
		background: rgba(80, 70, 50, 0.8);
		border-radius: 3px;
	}

	.blind-pull-hint {
		font-size: 10px;
		color: rgba(80, 70, 50, 0.9);
		text-align: center;
		background: rgba(212, 200, 168, 0.9);
		padding: 2px 8px;
		border-radius: 10px;
		transform: translateX(-50%);
		margin-left: 50%;
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
		background: rgba(10, 10, 15, 0.45);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #eee;
		font-size: 18px;
		cursor: pointer;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
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
