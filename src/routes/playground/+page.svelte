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
	import CloudBlobs from '$lib/atmosphere/clouds/CloudBlobs.svelte';
	import Weather from '$lib/atmosphere/weather/Weather.svelte';
	import MapLibreGlobe from './MapLibreGlobe.svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';

	// ─── State ───────────────────────────────────────────────────────────────
	let activeLocation = $state<LocationId>('dubai');
	let timeOfDay = $state(12);
	let weather = $state<WeatherType>('clear');
	let maplibreSource = $state<string>('cached-eox');

	let density = $state(0.6);
	let cloudSpeed = $state(1.0);

	let heading = $state(90);
	let planeSpeed = $state(1.0);
	let altitude = $state(30000);

	let autoOrbit = $state(false);
	let autoTime = $state(false);

	const motion = new MotionEngine();
	let simTime = $state(0);
	type TurbLevel = 'light' | 'moderate' | 'severe';
	let turbulenceLevel = $state<TurbLevel>('light');

	let mlTerrain = $state(true);
	let mlBuildings = $state(true);
	let mlAtmosphere = $state(true);

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
	const maplibreSrc = $derived(findSource(ALL_MAPLIBRE_SOURCES, maplibreSource));
	const skyState = $derived<SkyState>(getSkyState(timeOfDay));
	const nf = $derived(nightFactor(timeOfDay));
	const weatherFx = $derived(WEATHER_EFFECTS[weather]);
	const windAngle = $derived(weatherFx.windAngle);
	const frostAmount = $derived(clamp((altitude - 25000) / 15000, 0, 1));

	const bgGradient = $derived.by(() => {
		switch (skyState) {
			case 'night': return 'linear-gradient(180deg, #05060f 0%, #0f1428 55%, #1a1f35 100%)';
			case 'dawn': return 'linear-gradient(180deg, #1a1440 0%, #d96850 45%, #f0b070 70%, #d4a060 100%)';
			case 'dusk': return 'linear-gradient(180deg, #1a1a3e 0%, #c06040 35%, #ddaa70 55%, #5a4a3a 100%)';
			default: return 'linear-gradient(180deg, #4a90d9 0%, #7fb8ea 30%, #a4d4f4 55%, #b8c8a0 80%, #7a8860 100%)';
		}
	});

	// ─── RAF loop ────────────────────────────────────────────────────────────
	$effect(() => {
		let raf: number;
		let last = performance.now();
		const loop = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			simTime += dt;
			if (autoOrbit) heading = (heading + dt * 5 * planeSpeed) % 360;
			if (autoTime) timeOfDay = (timeOfDay + dt * 0.5) % 24;

			motion.tick(dt, {
				time: simTime,
				heading,
				altitude,
				turbulenceLevel,
				weather,
			} as any);

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
		turbulenceLevel = (['light', 'moderate', 'severe'] as TurbLevel[])[Math.floor(randomBetween(0, 3))];
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
				lat={currentLocation.lat}
				lon={currentLocation.lon}
				{altitude}
				pitch={70}
				bearing={heading}
				imageryUrl={maplibreSrc.isPmtiles ? '' : maplibreSrc.url}
				imageryAttribution={maplibreSrc.attribution ?? ''}
				pmtilesUrl={maplibreSrc.isPmtiles ? maplibreSrc.url : ''}
				showTerrain={mlTerrain}
				showBuildings={mlBuildings}
				showAtmosphere={mlAtmosphere}
				nightFactor={nf}
				terrainExaggeration={1.5}
				{lodMaxZoomLevels}
				{lodTileCountRatio}
			/>
		</div>

		<CloudBlobs {density} speed={cloudSpeed} {skyState} {heading} {altitude} {windAngle} />

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
		inset: -4px;
		will-change: transform;
	}

	.horizon-line {
		position: absolute;
		left: 0;
		right: 0;
		top: 55%;
		height: 1px;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1) 50%, transparent);
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
		background: rgba(0, 0, 0, 0.55);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #eee;
		padding: 6px 10px;
		border-radius: 8px;
		backdrop-filter: blur(6px);
		pointer-events: none;
		max-width: calc(100vw - 90px);
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
		transition: transform 0.2s;
	}
	.drawer-toggle:hover { transform: scale(1.05); }
	.drawer-toggle.open { transform: rotate(90deg); }

	.drawer {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 340px;
		z-index: 25;
		background: rgba(17, 17, 21, 0.96);
		border-left: 1px solid rgba(255, 255, 255, 0.08);
		padding: 64px 16px 16px;
		overflow-y: auto;
		transform: translateX(100%);
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		backdrop-filter: blur(10px);
	}
	.drawer.open { transform: translateX(0); }

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

	input[type="range"] { width: 100%; margin: 4px 0; }

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
		border-radius: 4px;
		padding: 4px 6px;
		font-size: 11px;
		text-transform: capitalize;
		cursor: pointer;
	}
	.chip-row button.active {
		background: #2a4060;
		color: #fff;
		border-color: #4080c0;
	}

	.source-btn {
		display: block;
		cursor: pointer;
		margin: 4px 0;
		padding: 6px 8px;
		background: #1a1a20;
		border: 1px solid #2a2a30;
		border-radius: 4px;
		transition: background 0.15s;
	}
	.source-btn:hover { background: #22232a; }
	.source-btn.active {
		background: #2a4060;
		border-color: #4080c0;
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
</style>
