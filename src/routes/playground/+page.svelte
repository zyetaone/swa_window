<script lang="ts">
	/**
	 * Playground — MapLibre scene lab.
	 *
	 * Scope: test MapLibre capabilities as a Cesium alternative.
	 *   — globe projection + atmosphere + sky
	 *   — 3D terrain (raster-dem) + 3D buildings (fill-extrusion)
	 *   — satellite imagery (offline + online sources)
	 *   — night rendering via data-driven material expressions
	 *   — cloud sprites + weather overlays (reused from main app)
	 *   — plane motion turbulence driving canvas transform
	 *
	 * Keep-alive pattern: production `/` is still Cesium. This route is
	 * isolated — no production code imports from here.
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
	let maplibreSource = $state<string>('eox-s2');

	// Cloud sim
	let density = $state(0.6);
	let cloudSpeed = $state(1.0);

	// Plane motion
	let heading = $state(90);
	let planeSpeed = $state(1.0);
	let altitude = $state(30000);

	// Auto-orbit — gentle drift for demo
	let autoOrbit = $state(false);
	let autoTime = $state(false);

	// Motion / turbulence
	const motion = new MotionEngine();
	let simTime = $state(0);
	type TurbLevel = 'light' | 'moderate' | 'severe';
	let turbulenceLevel = $state<TurbLevel>('light');

	// MapLibre layer toggles
	let mlTerrain = $state(false);
	let mlBuildings = $state(false);
	let mlAtmosphere = $state(true);

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

<div class="playground">
	<div class="viewport" style:background={bgGradient}>
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
			/>
		</div>

		<CloudBlobs {density} speed={cloudSpeed} {skyState} {heading} {altitude} {windAngle} />

		<Weather
			rainOpacity={weatherFx.rainOpacity}
			{windAngle}
			{frostAmount}
		/>

		<div class="horizon-line" aria-hidden="true"></div>

		<div class="hud">
			<span><b>{currentLocation.name}</b></span>
			<span>HDG {heading.toFixed(0)}°</span>
			<span>ALT {(altitude / 1000).toFixed(0)}k</span>
			<span>SPD {planeSpeed.toFixed(1)}×</span>
			<span>{formatTime(timeOfDay)}</span>
			<span class="sky-tag sky-{skyState}">{skyState.toUpperCase()}</span>
			<span class="wx-tag">{weather.toUpperCase()}</span>
		</div>
	</div>

	<aside class="controls">
		<header>
			<h2>MapLibre Scene Lab</h2>
			<p class="hint">Globe + atmosphere + terrain + buildings — all driven by GeoJSON + expressions.</p>
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
		display: grid;
		grid-template-columns: 1fr 340px;
		height: 100vh;
		background: #0b0b0e;
		color: #eee;
		font-family: system-ui, -apple-system, sans-serif;
	}

	.viewport {
		position: relative;
		overflow: hidden;
		border-right: 1px solid #222;
	}

	.globe-pane {
		position: absolute;
		inset: 0;
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

	.hud {
		position: absolute;
		bottom: 16px;
		left: 16px;
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

	.controls {
		padding: 16px;
		overflow-y: auto;
		background: #111115;
		border-left: 1px solid #222;
	}

	.controls header h2 {
		font-size: 15px;
		margin: 0 0 4px 0;
	}
	.controls header .hint {
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
		margin: 4px 0;
	}

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

	.source-btn:hover {
		background: #22232a;
	}

	.source-btn.active {
		background: #2a4060;
		border-color: #4080c0;
	}

	.source-btn input[type="radio"] {
		margin-right: 6px;
	}

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

	.btn:hover {
		background: #3a5070;
	}
</style>
