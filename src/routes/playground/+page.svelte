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

	import type { SkyState, LocationId } from '$lib/types';
	import { LOCATIONS, LOCATION_MAP } from '$lib/locations';
	import { WEATHER_EFFECTS } from '$lib/constants';
	import { getSkyState, nightFactor, clamp } from '$lib/utils';
	import { ALL_MAPLIBRE_SOURCES, findSource } from './imagery';
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
	import { PALETTE_ENTRIES, PALETTES } from './palettes';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { pg } from './lib/playground-state.svelte';
	import PlaygroundHud from './components/PlaygroundHud.svelte';
	import PlaygroundDrawer from './components/PlaygroundDrawer.svelte';

	// ─── State ───────────────────────────────────────────────────────────────  // online EOX — global coverage (cached sources only cover dubai/dallas/himalayas bboxes)

	let mapLat = $state(25.2);
	let mapLon = $state(55.3);

	// Tracking variables for effect (no $state needed since they just track previous value without driving UI)
	let lastActiveLocation: LocationId = 'dubai';

	// Randomize initial heading so each session starts with a different view
	// direction. Subsequent slow drift + occasional 'course correction' keeps
	// the passenger view alive without jarring the user.
	if (typeof window !== 'undefined') {
		pg.heading = Math.floor(Math.random() * 360);
	}
	// Orbital autoFly state — plane circles currentLocation instead of
	// drifting linearly. orbitAngularSpeed 0.07 rad/s → ~90s full orbit.
	let orbitAngle = Math.random() * Math.PI * 2;  // start at random angle
	const orbitAngularSpeed = 0.07;

	// Auto-cycle through locations every 2-4 minutes (120-240s). Each tick
	// picks the next location in LOCATIONS; landing on same keeps that city
	// visible for its full duration before rotating away.
	// Also randomizes altitude / pitch-bias / turbulence per cycle — each
	// city sequence has its own 'flight profile'.
	let nextLocationChange = performance.now() + (120_000 + Math.random() * 120_000);
	let pitchBias = $state(0);  // ±6° added to base pitch per flight segment
	function cycleLocation() {
		const ids = LOCATIONS.map(l => l.id);
		const idx = ids.indexOf(pg.activeLocation);
		pg.activeLocation = ids[(idx + 1) % ids.length];
		// New flight profile for this segment
		pg.altitude = 20_000 + Math.floor(Math.random() * 25_000);  // 20k-45k ft
		pitchBias = (Math.random() - 0.5) * 12;                      // ±6°
		const turbs: typeof pg.turbulenceLevel[] = ['light', 'light', 'light', 'moderate', 'moderate', 'severe'];
		pg.turbulenceLevel = turbs[Math.floor(Math.random() * turbs.length)];
		nextLocationChange = performance.now() + (120_000 + Math.random() * 120_000);
	}

	const motion = new MotionEngine();
	let simTime = $state(0);

	// Creative controls  // PoC sphere — ground-anchored, looks like a moon stuck on the map

	// Map instance exposed from MapLibreGlobe — fed to Three.js overlay.
	let mapRef = $state<maplibregl.Map | undefined>(undefined);

	// LOD tuning — see MapLibre level-of-detail-control example

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
		// Short tap — cycle to next location
		const ids = LOCATIONS.map(l => l.id);
		const idx = ids.indexOf(pg.activeLocation);
		pg.activeLocation = ids[(idx + 1) % ids.length];
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
	const currentLocation = $derived(LOCATION_MAP.get(pg.activeLocation) ?? LOCATIONS[0]);

	// Passenger-window camera bearing. Plane travels `pg.heading`; a passenger
	// looks 90° LEFT of travel (out the right-side window). Ground scrolls
	// laterally across the view, not rushing toward the camera.
	// Plus a small turbulence-driven wobble (±3°) for organic motion feel.
	const viewBearing = $derived(
		(pg.heading - 90 + motion.motionOffsetX * 0.3 + 360) % 360,
	);

	// Camera pitch responds to turbulence bumps — gentle ±2° wobble on top of
	// a base pitch (76°) + per-flight-segment pitchBias (±6°). Bank angle
	// (rolling during turns) stays on the CSS transform (motionTransform)
	// so it rolls the visual frame, not the MapLibre camera — more
	// comfortable for passengers to watch.
	const viewPitch = $derived(
		Math.max(62, Math.min(84, 76 + pitchBias + motion.motionOffsetY * 0.6)),
	);

	// Sync logic: change map center when user selects a new location
	$effect(() => {
		if (pg.activeLocation !== lastActiveLocation) {
			const loc = LOCATION_MAP.get(pg.activeLocation);
			if (loc) {
				mapLat = loc.lat;
				mapLon = loc.lon;
			}
			lastActiveLocation = pg.activeLocation;
		}
	});

	const maplibreSrc = $derived(findSource(ALL_MAPLIBRE_SOURCES, pg.maplibreSource));
	const skyState = $derived<SkyState>(getSkyState(pg.timeOfDay));
	const nf = $derived(nightFactor(pg.timeOfDay));
	const weatherFx = $derived(WEATHER_EFFECTS[pg.weather]);
	const windAngle = $derived(weatherFx.windAngle);
	const frostAmount = $derived(clamp((pg.altitude - 25000) / 15000, 0, 1));

	const bgGradient = $derived.by(() => {
		if (pg.paletteName !== 'auto' && PALETTES[pg.paletteName]) {
			const p = PALETTES[pg.paletteName];
			return `linear-gradient(180deg, ${p.sky} 0%, ${p.horizon} 60%, ${p.fog} 100%)`;
		}
		switch (skyState) {
			case 'night': return 'linear-gradient(180deg, #05060f 0%, #0f1428 55%, #1a1f35 100%)';
			case 'dawn': return 'linear-gradient(180deg, #1a1440 0%, #d96850 45%, #f0b070 70%, #d4a060 100%)';
			case 'dusk': return 'linear-gradient(180deg, #1a1a3e 0%, #c06040 35%, #ddaa70 55%, #5a4a3a 100%)';
			default: return 'linear-gradient(180deg, #4a90d9 0%, #7fb8ea 30%, #a4d4f4 55%, #b8c8a0 80%, #7a8860 100%)';
		}
	});

	$effect(() => {
		let raf: number;
		let last = performance.now();
		const loop = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			simTime += dt;
			if (pg.autoOrbit) pg.heading = (pg.heading + dt * 5 * pg.planeSpeed) % 360;
			if (pg.autoTime) pg.timeOfDay = (pg.timeOfDay + dt * 0.5) % 24;

			if (pg.autoFly || isBoosting) {
				// Auto-cycle through locations every 2-4 minutes
				if (now > nextLocationChange) cycleLocation();

				// Gentle altitude drift within the flight segment — plane slowly
				// climbs/descends between ±2000 ft per minute around target.
				// Uses sin(time) so altitude oscillates smoothly.
				const altOsc = Math.sin(now * 0.00006) * 2000;
				pg.altitude = Math.max(20_000, Math.min(45_000, pg.altitude + altOsc * dt * 0.3));

				// ORBITAL autoFly — plane circles the current city instead of
				// flying off into empty desert. Keeps the kiosk framed on its
				// subject while the view constantly rotates, giving the city
				// from every angle over a 90s cycle.
				orbitAngle += dt * orbitAngularSpeed * pg.planeSpeed;   // rad/s
				const loc = currentLocation;
				// Radius chosen so at z=10 the city fills ~2/3 of the frame.
				// ~0.08° ≈ 9km at equator, scales down toward poles via cos(lat).
				const radiusDeg = 0.075;
				const latRad = loc.lat * Math.PI / 180;
				mapLat = loc.lat + radiusDeg * Math.sin(orbitAngle);
				mapLon = loc.lon + radiusDeg * Math.cos(orbitAngle) / Math.max(Math.cos(latRad), 0.2);
				// Heading is tangent to the orbit circle — plane moves forward
				// along the tangent, so passenger (bearing = heading - 90)
				// looks at the city center.
				pg.heading = ((orbitAngle * 180 / Math.PI) + 90) % 360;
			}

			motion.tick(dt, {
				time: simTime,
				heading: pg.heading,
				altitude: pg.altitude,
				turbulenceLevel: pg.turbulenceLevel,
				weather: pg.weather,
				camera: cameraConfig,
				director: directorConfig,
				// unused fields required by SimulationContext
				lat: 0, lon: 0, pitch: 0, bankAngle: 0,
				skyState: 'day', nightFactor: 0, dawnDuskFactor: 0,
				locationId: pg.activeLocation,
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
					lon={currentLocation.lon}
					lat={currentLocation.lat}
					altitude={500}
					color="#ffd880"
				/>
			{/if}
		</div>

		{#if pg.useRealisticClouds}
			<PhotoClouds density={pg.density} speed={pg.cloudSpeed} heading={pg.heading} {windAngle} nightFactor={nf} weather={pg.weather} />
		{:else}
			<CloudBlobs density={pg.density} speed={pg.cloudSpeed} {skyState} heading={pg.heading} altitude={pg.altitude} {windAngle} />
		{/if}

		<NightOverlay nightFactor={nf} timeOfDay={pg.timeOfDay} />

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

	<PlaygroundHud {isBoosting} />

	<!-- Palette bar — tap a swatch to lock the sky mood -->
	<div class="palette-bar" role="group" aria-label="Ambient environment">
		{#each PALETTE_ENTRIES as entry (entry.name)}
			<button
				class="palette-swatch"
				class:active={pg.paletteName === entry.name}
				style:background={entry.swatchColor}
				title={entry.label}
				aria-label={entry.label}
				aria-pressed={pg.paletteName === entry.name}
				onclick={() => pg.paletteName = entry.name}
			>
				{#if pg.paletteName === entry.name}
					<span class="swatch-ring"></span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Drawer toggle — gear icon top-right. Click to open settings panel. -->
	<button
		class="drawer-toggle"
		class:open={drawerOpen}
		onclick={() => drawerOpen = !drawerOpen}
		aria-label="Toggle settings drawer"
		aria-expanded={drawerOpen}
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

	.viewport-btn:disabled { opacity: 0.6; cursor: not-allowed; }

	.globe-pane {
		position: absolute;
		/* Oversize: motion.tick rotates us up to ±6° via bank-angle. At the
		   typical 1500×800 viewport, a 6° rotation exposes up to ~80px at
		   the corners. -100px inset ensures the map always covers viewport
		   even at extreme turbulence. */
		inset: -100px;
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
		transition: transform 0.2s;
	}
	.drawer-toggle:hover { transform: scale(1.05); }
	.drawer-toggle.open { transform: rotate(90deg); }

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
