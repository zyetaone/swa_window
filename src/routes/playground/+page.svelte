<script lang="ts">
	/**
	 * Playground — MapLibre scene lab (app-shell mode).
	 *
	 * End-to-end map, no window frame. Blind overlay pulls down over the
	 * full viewport. HUD chip-bar at bottom-left. Right-side drawer hides
	 * the dev tuning controls behind a toggle so the app-surface feels
	 * clean by default.
	 *
	 * Long-press anywhere on the map = cruise boost (1.0× → 3.0×),
	 * release to ease back. Tap = fly to next location.
	 *
	 * Production `/` still runs Cesium. This route is isolated.
	 */

	import type { SkyState, LocationId, WeatherType } from '$lib/types';
	import { WEATHER_TYPES } from '$lib/types';
	import { LOCATIONS, LOCATION_MAP } from '$lib/locations';
	import { WEATHER_EFFECTS } from '$lib/constants';
	import { randomBetween, getSkyState, nightFactor, formatTime, clamp } from '$lib/utils';
	import { MAPLIBRE_SOURCES, CACHED_SOURCES, ALL_MAPLIBRE_SOURCES, findSource } from './imagery';
	import { FLIGHT_FEEL } from '$lib/constants';
	import { MotionEngine } from '$lib/camera/motion.svelte';
	// Local playground config — no coupling to main-app's reactive config tree.
	import { playgroundCameraConfig as cameraConfig, playgroundDirectorConfig as directorConfig } from './lib/motion-config';
	import CloudBlobs from '$lib/atmosphere/clouds/CloudBlobs.svelte';
	import Weather from '$lib/atmosphere/weather/Weather.svelte';
	import MapLibreGlobe from './MapLibreGlobe.svelte';
	import NightOverlay from './NightOverlay.svelte';
	import ThreeBillboards from './ThreeBillboards.svelte';
	import PhotoClouds from './PhotoClouds.svelte';
	import type maplibregl from 'maplibre-gl';
	import { PALETTE_ENTRIES, PALETTES, type PaletteName } from './palettes';
	import 'maplibre-gl/dist/maplibre-gl.css';

	// ─── State ───────────────────────────────────────────────────────────────
	let activeLocation = $state<LocationId>('dubai');
	let timeOfDay = $state(12);
	let weather = $state<WeatherType>('clear');
	let maplibreSource = $state<string>('eox-s2');  // online EOX — global coverage (cached sources only cover dubai/dallas/himalayas bboxes)

	let density = $state(0.6);
	let cloudSpeed = $state(1.0);

	let heading = $state(90);
	let planeSpeed = $state(1.0);
	let altitude = $state(30000);

	let autoOrbit = $state(false);
	let autoTime = $state(false);
	let autoFly = $state(false);

	let mapLat = $state(25.2);
	let mapLon = $state(55.3);

	// Tracking variables for effect (no $state needed since they just track previous value without driving UI)
	let lastActiveLocation: LocationId = 'dubai';

	const motion = new MotionEngine();
	let simTime = $state(0);
	type TurbLevel = 'light' | 'moderate' | 'severe';
	let turbulenceLevel = $state<TurbLevel>('light');

	let mlTerrain = $state(true);
	let mlBuildings = $state(true);
	let mlAtmosphere = $state(true);

	// Creative controls
	let paletteName = $state<PaletteName>('auto');
	let freeCam = $state(false);
	let showCityLights = $state(true);
	let showThreeBillboards = $state(true);
	let useRealisticClouds = $state(true);

	// Map instance exposed from MapLibreGlobe — fed to Three.js overlay.
	let mapRef = $state<maplibregl.Map | undefined>(undefined);

	// LOD tuning — see MapLibre level-of-detail-control example
	let lodMaxZoomLevels = $state(6);
	let lodTileCountRatio = $state(2.0);

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
			planeSpeed = from + (to - from) * (t * t * (3 - 2 * t));
			if (t < 1) boostRampId = requestAnimationFrame(step);
			else boostRampId = null;
		};
		boostRampId = requestAnimationFrame(step);
	}

	function handlePointerDown() {
		pressTimer = window.setTimeout(() => {
			pressTimer = null;
			isBoosting = true;
			rampSpeed(planeSpeed, BOOST_SPEED, RAMP_UP_MS);
		}, LONG_PRESS_MS);
	}

	function handleMapTap() {
		// Short tap — cycle to next location
		const ids = LOCATIONS.map(l => l.id);
		const idx = ids.indexOf(activeLocation);
		activeLocation = ids[(idx + 1) % ids.length];
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
			rampSpeed(planeSpeed, BASE_SPEED, RAMP_DOWN_MS);
		}
	}

	function handlePointerCancel() {
		if (pressTimer !== null) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
		if (isBoosting) {
			isBoosting = false;
			rampSpeed(planeSpeed, BASE_SPEED, RAMP_DOWN_MS);
		}
	}

	// ─── Blind drag ──────────────────────────────────────────────────────────
	let blindY = $state(0);           // 0 = fully up (open), 100 = fully down (covered)
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
		// Snap to nearest end
		blindY = blindY > 40 ? 100 : 0;
	}

	// ─── Derived ─────────────────────────────────────────────────────────────
	const currentLocation = $derived(LOCATION_MAP.get(activeLocation) ?? LOCATIONS[0]);

	// Sync logic: change map center when user selects a new location
	$effect(() => {
		if (activeLocation !== lastActiveLocation) {
			const loc = LOCATION_MAP.get(activeLocation);
			if (loc) {
				mapLat = loc.lat;
				mapLon = loc.lon;
			}
			lastActiveLocation = activeLocation;
		}
	});

	const maplibreSrc = $derived(findSource(ALL_MAPLIBRE_SOURCES, maplibreSource));
	const skyState = $derived<SkyState>(getSkyState(timeOfDay));
	const nf = $derived(nightFactor(timeOfDay));
	const weatherFx = $derived(WEATHER_EFFECTS[weather]);
	const windAngle = $derived(weatherFx.windAngle);
	const frostAmount = $derived(clamp((altitude - 25000) / 15000, 0, 1));

	const bgGradient = $derived.by(() => {
		if (paletteName !== 'auto' && PALETTES[paletteName]) {
			const p = PALETTES[paletteName];
			return `linear-gradient(180deg, ${p.sky} 0%, ${p.horizon} 60%, ${p.fog} 100%)`;
		}
		switch (skyState) {
			case 'night': return 'linear-gradient(180deg, #05060f 0%, #0f1428 55%, #1a1f35 100%)';
			case 'dawn': return 'linear-gradient(180deg, #1a1440 0%, #d96850 45%, #f0b070 70%, #d4a060 100%)';
			case 'dusk': return 'linear-gradient(180deg, #1a1a3e 0%, #c06040 35%, #ddaa70 55%, #5a4a3a 100%)';
			default: return 'linear-gradient(180deg, #4a90d9 0%, #7fb8ea 30%, #a4d4f4 55%, #b8c8a0 80%, #7a8860 100%)';
		}
	});

	// ─── RAF loop ────────────────────────────────────────────────────────────
	function moveForward(lat: number, lon: number, headingDeg: number, distanceMeters: number) {
		const R = 6371e3; // Earth radius in meters
		const rad = Math.PI / 180;
		const rHeading = headingDeg * rad;
		const rLat1 = lat * rad;
		const rLon1 = lon * rad;

		const rLat2 = Math.asin(Math.sin(rLat1) * Math.cos(distanceMeters / R) +
								Math.cos(rLat1) * Math.sin(distanceMeters / R) * Math.cos(rHeading));
		const rLon2 = rLon1 + Math.atan2(Math.sin(rHeading) * Math.sin(distanceMeters / R) * Math.cos(rLat1),
								Math.cos(distanceMeters / R) - Math.sin(rLat1) * Math.sin(rLat2));

		return { lat: rLat2 / rad, lon: rLon2 / rad };
	}

	$effect(() => {
		let raf: number;
		let last = performance.now();
		const loop = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			simTime += dt;
			if (autoOrbit) heading = (heading + dt * 5 * planeSpeed) % 360;
			if (autoTime) timeOfDay = (timeOfDay + dt * 0.5) % 24;

			if (autoFly || isBoosting) {
				// Cruise speed ~250m/s (roughly 900km/h) base. planeSpeed scales this.
				const speedMps = 250 * planeSpeed;
				const distanceMeters = speedMps * dt;
				const nextCoords = moveForward(mapLat, mapLon, heading, distanceMeters);
				mapLat = nextCoords.lat;
				mapLon = nextCoords.lon;
			}

			motion.tick(dt, {
				time: simTime,
				heading,
				altitude,
				turbulenceLevel,
				weather,
				camera: cameraConfig,
				director: directorConfig,
				// unused fields required by SimulationContext
				lat: 0, lon: 0, pitch: 0, bankAngle: 0,
				skyState: 'day', nightFactor: 0, dawnDuskFactor: 0,
				locationId: activeLocation,
				userAdjustingAltitude: false, userAdjustingTime: false, userAdjustingAtmosphere: false,
				cloudDensity: 0, cloudSpeed: 0, haze: 0,
			});

			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	// Motion transform applied to the map pane (matches Window.svelte feel)
	const motionTransform = $derived.by(() => {
		const turbY = motion.motionOffsetY * 0.08;
		const turbX = motion.motionOffsetX * 0.08;
		const turbRot = motion.motionOffsetY * 0.02;
		const breathY = motion.breathingOffset * FLIGHT_FEEL.BREATHING_AMPLITUDE;
		const bank = motion.bankAngle;
		const x = turbX + motion.engineVibeX;
		const y = turbY + breathY + motion.engineVibeY;
		return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${(turbRot + bank).toFixed(3)}deg)`;
	});

	// ─── Preset actions ──────────────────────────────────────────────────────
	function randomize() {
		heading = Math.floor(randomBetween(0, 360));
		altitude = Math.floor(randomBetween(15000, 45000));
		density = randomBetween(0.3, 0.9);
		cloudSpeed = randomBetween(0.5, 2);
		timeOfDay = randomBetween(0, 24);
		turbulenceLevel = (['light', 'moderate', 'severe'] as TurbLevel[])[Math.floor(randomBetween(0, 2.99))];
	}

	function reset() {
		heading = 90;
		altitude = 30000;
		planeSpeed = 1.0;
		density = 0.6;
		cloudSpeed = 1.0;
		timeOfDay = 12;
		weather = 'clear';
		autoOrbit = false;
		autoTime = false;
		autoFly = false;
		turbulenceLevel = 'light';
	}
</script>

<div class="playground" class:boosting={isBoosting}>
	<!-- Full-viewport map — end to end, no frame -->
	<button
		class="viewport-btn"
		style:background={bgGradient}
		onpointerdown={handlePointerDown}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerCancel}
		onpointerleave={handlePointerCancel}
		type="button"
		aria-label="Tap to fly to next location. Hold to boost speed."
	>
		<div class="globe-pane" style:transform={motionTransform}>
			<MapLibreGlobe
				bind:mapRef
				lat={mapLat}
				lon={mapLon}
				{altitude}
				pitch={40}
				bearing={heading}
				imageryUrl={maplibreSrc.isPmtiles ? '' : maplibreSrc.url}
				imageryAttribution={maplibreSrc.attribution ?? ''}
				imageryMaxZoom={maplibreSrc.maxZoom ?? 14}
				pmtilesUrl={maplibreSrc.isPmtiles ? maplibreSrc.url : ''}
				showTerrain={mlTerrain}
				showBuildings={mlBuildings}
				showAtmosphere={mlAtmosphere}
				nightFactor={nf}
				{timeOfDay}
				{paletteName}
				{freeCam}
				{showCityLights}
				terrainExaggeration={1.5}
				{lodMaxZoomLevels}
				{lodTileCountRatio}
			/>
			{#if showThreeBillboards && mapRef}
				<ThreeBillboards
					map={mapRef}
					lon={currentLocation.lon}
					lat={currentLocation.lat}
					altitude={500}
					color="#ffd880"
				/>
			{/if}
		</div>

		{#if useRealisticClouds}
			<PhotoClouds {density} speed={cloudSpeed} {heading} {windAngle} nightFactor={nf} />
		{:else}
			<CloudBlobs {density} speed={cloudSpeed} {skyState} {heading} {altitude} {windAngle} />
		{/if}

		<NightOverlay nightFactor={nf} />

		<Weather
			rainOpacity={weatherFx.rainOpacity}
			{windAngle}
			{frostAmount}
		/>

		<div class="horizon-line" aria-hidden="true"></div>
	</button>

	<!-- Blind overlay — pull-down shade, covers full rectangle (no frame) -->
	<div
		class="blind"
		class:dragging={blindDragging}
		style:transform={`translateY(${blindY - 100}%)`}
	>
		<div class="blind-surface"></div>
		<button
			class="blind-pull"
			aria-label="Pull blind up or down"
			onpointerdown={handleBlindPointerDown}
			onpointermove={handleBlindPointerMove}
			onpointerup={handleBlindPointerUp}
			onpointercancel={handleBlindPointerUp}
		>
			<div class="blind-pull-grip"></div>
			<div class="blind-pull-hint">
				{blindY > 50 ? '↑ pull up' : '↓ pull down'}
			</div>
		</button>
	</div>

	<!-- HUD chips — bottom-left -->
	<div class="hud">
		<span><b>{currentLocation.name}</b></span>
		<span>HDG {heading.toFixed(0)}°</span>
		<span>ALT {(altitude / 1000).toFixed(0)}k</span>
		<span>SPD {planeSpeed.toFixed(1)}×</span>
		<span>{formatTime(timeOfDay)}</span>
		<span class="sky-tag sky-{skyState}">{skyState.toUpperCase()}</span>
		<span class="wx-tag">{weather.toUpperCase()}</span>
		{#if isBoosting}<span class="boost-tag">⚡ BOOST</span>{/if}
	</div>

	<!-- Palette bar — tap a swatch to lock the sky mood -->
	<div class="palette-bar" role="group" aria-label="Sky mood">
		{#each PALETTE_ENTRIES as entry (entry.name)}
			<button
				class="palette-swatch"
				class:active={paletteName === entry.name}
				style:background={entry.swatchColor}
				title={entry.label}
				aria-label={entry.label}
				aria-pressed={paletteName === entry.name}
				onclick={() => paletteName = entry.name}
			>
				{#if paletteName === entry.name}
					<span class="swatch-ring"></span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Drawer toggle — top-right -->
	<button
		class="drawer-toggle"
		class:open={drawerOpen}
		onclick={() => drawerOpen = !drawerOpen}
		aria-label="Toggle settings drawer"
		aria-expanded={drawerOpen}
	>
		{drawerOpen ? '✕' : '⚙'}
	</button>

	<!-- Settings drawer — slides in from right -->
	<aside class="drawer" class:open={drawerOpen} aria-hidden={!drawerOpen}>
		<header>
			<h2>Scene Lab</h2>
			<p class="hint">MapLibre globe + atmosphere + terrain + buildings. GeoJSON-driven styling.</p>
		</header>

		<fieldset>
			<legend>Location</legend>
			<select class="select" bind:value={activeLocation}>
				{#each LOCATIONS as loc (loc.id)}
					<option value={loc.id}>{loc.name}</option>
				{/each}
			</select>
		</fieldset>

		<fieldset>
			<legend>Time of day</legend>
			<label>{formatTime(timeOfDay)} <span class="val sky-{skyState}">{skyState}</span>
				<input type="range" bind:value={timeOfDay} min="0" max="24" step="0.1" disabled={autoTime} />
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={autoTime} />
				Auto-advance (48s = full day)
			</label>
		</fieldset>

		<fieldset>
			<legend>Weather</legend>
			<div class="chip-row weather-chips">
				{#each WEATHER_TYPES as w (w)}
					<button class={[weather === w && 'active']} onclick={() => weather = w}>{w}</button>
				{/each}
			</div>
		</fieldset>

		<fieldset>
			<legend>Imagery</legend>
			{#each MAPLIBRE_SOURCES as src (src.id)}
				<label class={['source-btn', maplibreSource === src.id && 'active']}>
					<input type="radio" name="maplibre-src" checked={maplibreSource === src.id} onchange={() => maplibreSource = src.id} />
					<span class="source-name">{src.label}</span>
					<span class="source-note">{src.note}</span>
				</label>
			{/each}
		</fieldset>

		<fieldset>
			<legend>🗄️ Cached (offline)</legend>
			<p class="field-note">Pre-downloaded for dubai / dallas / himalayas — 189 MB total</p>
			{#each CACHED_SOURCES as src (src.id)}
				<label class={['source-btn', maplibreSource === src.id && 'active']}>
					<input type="radio" name="maplibre-src" checked={maplibreSource === src.id} onchange={() => maplibreSource = src.id} />
					<span class="source-name">{src.label}</span>
					<span class="source-note">{src.note}</span>
				</label>
			{/each}
		</fieldset>

		<fieldset>
			<legend>Layers</legend>
			<label class="check"><input type="checkbox" bind:checked={mlAtmosphere} /> Atmosphere + Sky</label>
			<label class="check"><input type="checkbox" bind:checked={mlTerrain} /> 3D Terrain (raster-dem)</label>
			<label class="check"><input type="checkbox" bind:checked={mlBuildings} /> 3D Buildings (fill-extrusion)</label>
			<label class="check"><input type="checkbox" bind:checked={showCityLights} /> City-light glow (night)</label>
		</fieldset>

		<fieldset>
			<legend>LOD (Pi tuning)</legend>
			<p class="field-note">setSourceTileLodParams — trades distant crispness for lower tile load.</p>
			<label>Max zoom levels <span class="val">{lodMaxZoomLevels}</span>
				<input type="range" bind:value={lodMaxZoomLevels} min="1" max="11" step="1" />
			</label>
			<label>Tile count ratio <span class="val">{lodTileCountRatio.toFixed(1)}</span>
				<input type="range" bind:value={lodTileCountRatio} min="1" max="10" step="0.1" />
			</label>
		</fieldset>

		<fieldset>
			<legend>Clouds</legend>
			<label class="check"><input type="checkbox" bind:checked={useRealisticClouds} /> Photo clouds (SVG feDisplacement)</label>
			<label>Density <span class="val">{(density * 100).toFixed(0)}%</span>
				<input type="range" bind:value={density} min="0" max="1" step="0.01" />
			</label>
			<label>Drift speed <span class="val">{cloudSpeed.toFixed(1)}×</span>
				<input type="range" bind:value={cloudSpeed} min="0.1" max="3" step="0.1" />
			</label>
		</fieldset>

		<fieldset>
			<legend>Plane</legend>
			<label>Heading <span class="val">{heading.toFixed(0)}°</span>
				<input type="range" bind:value={heading} min="0" max="360" step="1" disabled={autoOrbit} />
			</label>
			<label>Speed <span class="val">{planeSpeed.toFixed(1)}×</span>
				<input type="range" bind:value={planeSpeed} min="0.1" max="5" step="0.1" />
			</label>
			<label>Altitude <span class="val">{(altitude / 1000).toFixed(0)}k ft</span>
				<input type="range" bind:value={altitude} min="5000" max="45000" step="1000" />
			</label>
			<label>Turbulence <span class="val">{turbulenceLevel}</span>
				<select bind:value={turbulenceLevel}>
					<option value="light">Light</option>
					<option value="moderate">Moderate</option>
					<option value="severe">Severe</option>
				</select>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={autoOrbit} />
				Auto-orbit heading
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={autoFly} />
				Auto-fly forward
			</label>
		</fieldset>

		<div class="actions">
			<button class="btn" onclick={randomize}>Randomize</button>
			<button class="btn" onclick={reset}>Reset</button>
		</div>
	</aside>
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

	.viewport-btn:disabled { opacity: 0.6; cursor: not-allowed; }

	.globe-pane {
		position: absolute;
		inset: 0;
		will-change: transform;
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
		white-space: nowrap;
		display: inline-block;
		margin: 0 auto;
		width: max-content;
		transform: translateX(-50%);
		margin-left: 50%;
	}

	/* ─── HUD ────────────────────────────────────────────────────────────── */
	.hud {
		position: absolute;
		bottom: 16px;
		left: 16px;
		z-index: 10;
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		font-size: 12px;
		background: rgba(10, 10, 15, 0.45);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #f0f0f0;
		padding: 8px 12px;
		border-radius: 12px;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
		pointer-events: none;
		max-width: calc(100vw - 90px);
		animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	@keyframes fadeUp {
		from { opacity: 0; transform: translateY(10px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.hud span {
		padding: 2px 6px;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 4px;
	}
	.sky-tag.sky-night { background: #1a2040; color: #7faeff; }
	.sky-tag.sky-dawn  { background: #402818; color: #ffb070; }
	.sky-tag.sky-dusk  { background: #301838; color: #d080e0; }
	.sky-tag.sky-day   { background: #204060; color: #a0d4ff; }
	.wx-tag { background: #202028; color: #c0c4cc; }
	.boost-tag {
		background: #ff8844 !important;
		color: #fff !important;
		animation: pulse 0.6s ease-in-out infinite alternate;
	}
	@keyframes pulse {
		from { opacity: 0.85; }
		to { opacity: 1; }
	}

	/* ─── Boost visual cue ───────────────────────────────────────────────── */
	.playground.boosting .viewport-btn {
		box-shadow: inset 0 0 60px rgba(255, 210, 120, 0.15);
		transition: box-shadow 0.3s ease;
	}

	/* ─── Drawer ─────────────────────────────────────────────────────────── */
	.drawer-toggle {
		position: absolute;
		top: 16px;
		right: 16px;
		z-index: 30;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.6);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: #eee;
		font-size: 18px;
		cursor: pointer;
		backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s, border-color 0.2s;
	}
	.drawer-toggle:hover { 
		transform: scale(1.1); 
		background: rgba(255, 255, 255, 0.1); 
		border-color: rgba(255, 255, 255, 0.3);
	}
	.drawer-toggle.open { 
		transform: rotate(90deg) scale(0.9); 
		background: rgba(0, 0, 0, 0.8);
	}

	.drawer {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 340px;
		z-index: 25;
		background: rgba(12, 12, 16, 0.85);
		border-left: 1px solid rgba(255, 255, 255, 0.12);
		padding: 64px 16px 16px;
		overflow-y: auto;
		transform: translateX(100%);
		transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease;
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		box-shadow: -10px 0 30px rgba(0, 0, 0, 0);
	}
	.drawer.open { 
		transform: translateX(0); 
		box-shadow: -10px 0 40px rgba(0, 0, 0, 0.3);
	}

	/* Sleek scrollbar for the drawer */
	.drawer::-webkit-scrollbar { width: 6px; }
	.drawer::-webkit-scrollbar-track { background: transparent; }
	.drawer::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 3px; }
	.drawer::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }

	.drawer header h2 {
		font-size: 15px;
		margin: 0 0 4px 0;
	}
	.drawer header .hint {
		margin: 0 0 14px 0;
		font-size: 11px;
		color: #999;
		line-height: 1.4;
	}

	fieldset {
		border: 1px solid #222;
		border-radius: 6px;
		margin: 0 0 12px 0;
		padding: 10px 12px;
	}

	fieldset legend {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.8px;
		color: #888;
		padding: 0 6px;
	}

	label {
		display: block;
		font-size: 12px;
		color: #ccc;
		margin: 6px 0;
	}
	label .val {
		float: right;
		color: #7faeff;
		font-family: ui-monospace, monospace;
		font-size: 11px;
	}
	label.check {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 8px 0;
	}

	input[type="range"] { 
		width: 100%; 
		margin: 8px 0; 
		-webkit-appearance: none;
		appearance: none;
		background: transparent;
	}
	input[type="range"]:focus { outline: none; }
	input[type="range"]::-webkit-slider-runnable-track {
		width: 100%;
		height: 4px;
		background: rgba(255, 255, 255, 0.15);
		border-radius: 2px;
		transition: background 0.2s;
	}
	input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none;
		height: 14px;
		width: 14px;
		border-radius: 50%;
		background: #7faeff;
		cursor: pointer;
		margin-top: -5px;
		box-shadow: 0 0 10px rgba(127, 174, 255, 0.4);
		transition: transform 0.2s, box-shadow 0.2s;
	}
	input[type="range"]:hover::-webkit-slider-thumb {
		transform: scale(1.2);
		box-shadow: 0 0 14px rgba(127, 174, 255, 0.6);
	}
	input[type="range"]:disabled::-webkit-slider-thumb { background: #555; box-shadow: none; cursor: not-allowed; }
	input[type="range"]:disabled::-webkit-slider-runnable-track { background: rgba(255, 255, 255, 0.05); }

	.select,
	select {
		width: 100%;
		background: #1a1a20;
		color: #eee;
		border: 1px solid #2a2a30;
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 12px;
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip-row button {
		flex: 1;
		min-width: 50px;
		background: #1a1a20;
		color: #aaa;
		border: 1px solid #2a2a30;
		border-radius: 6px;
		padding: 6px;
		font-size: 11px;
		text-transform: capitalize;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.chip-row button:hover {
		background: #2a2a3a;
		transform: translateY(-1px);
		border-color: #445;
	}
	.chip-row button.active {
		background: linear-gradient(180deg, #2a4060, #1c2b42);
		color: #fff;
		border-color: #4080c0;
		box-shadow: 0 2px 8px rgba(64, 128, 192, 0.3);
	}

	.source-btn {
		display: block;
		cursor: pointer;
		margin: 6px 0;
		padding: 8px 10px;
		background: #1a1a20;
		border: 1px solid #2a2a30;
		border-radius: 6px;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.source-btn:hover { 
		background: #22232a; 
		transform: translateX(2px);
	}
	.source-btn.active {
		background: linear-gradient(135deg, #1c2b42, #2a4060);
		border-color: #4080c0;
		box-shadow: 0 4px 12px rgba(64, 128, 192, 0.15);
	}
	.source-btn input[type="radio"] { margin-right: 6px; }

	.source-name {
		font-size: 12px;
		color: #eee;
		font-weight: 500;
	}
	.source-note {
		display: block;
		font-size: 10px;
		color: #888;
		margin-top: 2px;
		margin-left: 20px;
	}

	.field-note {
		font-size: 10px;
		color: #777;
		margin: 0 0 6px 0;
		line-height: 1.4;
	}

	.actions {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}
	.btn {
		flex: 1;
		padding: 8px;
		background: #2a4060;
		color: #fff;
		border: 1px solid #4080c0;
		border-radius: 4px;
		font-size: 12px;
		cursor: pointer;
	}
	.btn:hover { background: #3a5070; }

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
		background: rgba(0, 0, 0, 0.5);
		border: 1px solid rgba(255, 255, 255, 0.1);
		padding: 6px 10px;
		border-radius: 20px;
		backdrop-filter: blur(8px);
	}

	.palette-swatch {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 1.5px solid rgba(255, 255, 255, 0.25);
		cursor: pointer;
		position: relative;
		transition: transform 0.15s ease, border-color 0.15s ease;
		flex-shrink: 0;
	}
	.palette-swatch:hover {
		transform: scale(1.2);
		border-color: rgba(255, 255, 255, 0.5);
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
