<script lang="ts">
	/**
	 * Playground — live rendering sandbox.
	 * Compare Cesium vs MapLibre globes, test imagery sources,
	 * preview sky states, and drive cloud parallax from simulated plane motion.
	 */

	import type { SkyState, LocationId, WeatherType } from '$lib/types';
	import { WEATHER_TYPES } from '$lib/types';
	import { LOCATIONS, LOCATION_MAP } from '$lib/locations';
	import { WEATHER_EFFECTS } from '$lib/constants';
	import { randomBetween, getSkyState, nightFactor, formatTime, clamp } from '$lib/utils';
	import { CESIUM_SOURCES, MAPLIBRE_SOURCES, CACHED_SOURCES, ALL_MAPLIBRE_SOURCES, findSource } from './sources';
	import { getIonToken, initCesiumGlobal, VIEWER_OPTIONS } from '$lib/world/config';
	import { FLIGHT_FEEL } from '$lib/constants';
	import { MotionEngine } from '$lib/simulation/motion.svelte';
	import CloudBlobs from '$lib/ui/CloudBlobs.svelte';
	import Weather from '$lib/ui/Weather.svelte';
	import MapLibreGlobe from './MapLibreGlobe.svelte';
	import { onMount } from 'svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import * as Cesium from 'cesium';

	type Tab = 'cesium' | 'maplibre' | 'compare';

	// ─── State ───────────────────────────────────────────────────────────────
	let activeTab = $state<Tab>('cesium');
	let activeLocation = $state<LocationId>('dubai');
	let timeOfDay = $state(12);  // 0-24, drives skyState
	let weather = $state<WeatherType>('clear');
	let cesiumSource = $state<string>('esri');
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
	let autoTime = $state(false);  // advance timeOfDay in real time

	// Motion / turbulence
	const motion = new MotionEngine();
	let simTime = $state(0);  // elapsed seconds for motion engine
	type TurbLevel = 'light' | 'moderate' | 'severe';
	let turbulenceLevel = $state<TurbLevel>('light');

	// MapLibre layer toggles (passes through to MapLibreGlobe)
	let mlTerrain = $state(false);
	let mlBuildings = $state(false);
	let mlAtmosphere = $state(true);

	// Cesium lifecycle
	let viewerContainer = $state<HTMLDivElement | null>(null);
	let cesiumViewer: Cesium.Viewer | null = null;
	let cesiumLoaded = $state(false);

	// ─── Derived ─────────────────────────────────────────────────────────────
	const currentLocation = $derived(LOCATION_MAP.get(activeLocation) ?? LOCATIONS[0]);
		const maplibreSrc = $derived(findSource(ALL_MAPLIBRE_SOURCES, maplibreSource));
	const cesiumSrc = $derived(findSource(CESIUM_SOURCES, cesiumSource));
	const skyState = $derived<SkyState>(getSkyState(timeOfDay));
	const nf = $derived(nightFactor(timeOfDay));
	const weatherFx = $derived(WEATHER_EFFECTS[weather]);
	const windAngle = $derived(weatherFx.windAngle);

	// Frost altitude-driven (matches Window.svelte logic)
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
			if (autoTime) timeOfDay = (timeOfDay + dt * 0.5) % 24;  // 48s = full day

			// Tick motion engine
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

	// Motion transform for globe (matches Window.svelte motion feel)
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

	// ─── Cesium ──────────────────────────────────────────────────────────────
	function initCesium() {
		if (!viewerContainer || cesiumViewer) return;
		try {
			initCesiumGlobal(Cesium);
			// Playground wants gradient to show through — override webgl.alpha
			cesiumViewer = new Cesium.Viewer(viewerContainer, {
				...VIEWER_OPTIONS,
				contextOptions: { webgl: { alpha: true, antialias: true } },
			});
			applyCesiumSource();
			if (getIonToken()) {
				Cesium.createWorldTerrainAsync()
					.then(t => { if (cesiumViewer) cesiumViewer.terrainProvider = t; })
					.catch(() => {});
			}
			// Set initial camera position synchronously, then mark loaded
			const altMeters = altitude * 0.3048;
			cesiumViewer.camera.setView({
				destination: Cesium.Cartesian3.fromDegrees(currentLocation.lon, currentLocation.lat, altMeters),
				orientation: {
					heading: Cesium.Math.toRadians(heading),
					pitch: Cesium.Math.toRadians(-20),
					roll: 0,
				},
			});
			cesiumLoaded = true;
			// Resize after layout settles
			requestAnimationFrame(() => cesiumViewer?.resize());
		} catch (e) { console.warn('[Playground] Cesium init failed:', e); }
	}

	function applyCesiumSource() {
		if (!cesiumViewer) return;
		try {
			cesiumViewer.imageryLayers.removeAll();
			cesiumViewer.imageryLayers.addImageryProvider(
				new Cesium.UrlTemplateImageryProvider({
					url: cesiumSrc.url,
					maximumLevel: cesiumSrc.maxZoom ?? 19,
					minimumLevel: 0,
					tilingScheme: new Cesium.WebMercatorTilingScheme(),
				})
			);
		} catch (e) { console.warn('[Playground] Cesium source swap failed:', e); }
	}

	function flyCesiumTo(loc: { lat: number; lon: number }) {
		if (!cesiumViewer || !cesiumLoaded) return;
		const altMeters = altitude * 0.3048;
		cesiumViewer.camera.flyTo({
			destination: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, altMeters),
			orientation: {
				heading: Cesium.Math.toRadians(heading),
				pitch: Cesium.Math.toRadians(-20),
				roll: 0,
			},
			duration: 1.5,
		});
	}

	// React to source changes
	$effect(() => {
		cesiumSource; // track
		if (cesiumViewer && cesiumLoaded) applyCesiumSource();
	});

	// Fly to selected location whenever it changes
	$effect(() => {
		if (cesiumViewer && cesiumLoaded) flyCesiumTo(currentLocation);
	});

	// Init/destroy Cesium when tab shows/hides it
	$effect(() => {
		if ((activeTab === 'cesium' || activeTab === 'compare') && viewerContainer && !cesiumViewer) {
			initCesium();
		} else if (cesiumViewer && (activeTab === 'cesium' || activeTab === 'compare')) {
			requestAnimationFrame(() => cesiumViewer?.resize());
		}
		if (activeTab === 'maplibre' && cesiumViewer) {
			cesiumViewer.destroy();
			cesiumViewer = null;
			cesiumLoaded = false;
		}
	});

	onMount(() => {
		const onResize = () => cesiumViewer?.resize();
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('resize', onResize);
			cesiumViewer?.destroy();
		};
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
		<!-- Cesium -->
		{#if activeTab === 'cesium' || activeTab === 'compare'}
			<div class="globe-pane" class:half={activeTab === 'compare'} class:left={activeTab === 'compare'} style:transform={motionTransform}>
				<div bind:this={viewerContainer} class="cesium-viewer"></div>
				{#if !cesiumLoaded}
					<div class="globe-loading">Loading Cesium…</div>
				{/if}
			</div>
		{/if}

		<!-- MapLibre -->
		{#if activeTab === 'maplibre' || activeTab === 'compare'}
			<div class="globe-pane" class:half={activeTab === 'compare'} class:right={activeTab === 'compare'} style:transform={motionTransform}>
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
		{/if}

		<CloudBlobs {density} speed={cloudSpeed} {skyState} {heading} {altitude} {windAngle} />

		<Weather
			rainOpacity={weatherFx.rainOpacity}
			{windAngle}
			{frostAmount}
		/>

		{#if activeTab === 'compare'}
			<div class="compare-divider" aria-hidden="true">
				<span>CESIUM</span>
				<span>MAPLIBRE</span>
			</div>
		{/if}

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
			<h2>Globe Playground</h2>
			<p class="hint">Compare renderers, tune clouds, drive plane motion.</p>
		</header>

		<!-- Tabs -->
		<div class="tab-bar" role="tablist">
			{#each ['cesium', 'maplibre', 'compare'] as const as t (t)}
				<button role="tab" aria-selected={activeTab === t} class:active={activeTab === t} onclick={() => activeTab = t}>
					{t === 'compare' ? 'Split' : t[0].toUpperCase() + t.slice(1)}
				</button>
			{/each}
		</div>

		<!-- Location -->
		<fieldset>
			<legend>Location</legend>
			<select class="select" bind:value={activeLocation}>
				{#each LOCATIONS as loc (loc.id)}
					<option value={loc.id}>{loc.name}</option>
				{/each}
			</select>
		</fieldset>

		<!-- Time of day -->
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

		<!-- Weather -->
		<fieldset>
			<legend>Weather</legend>
			<div class="chip-row weather-chips">
				{#each WEATHER_TYPES as w (w)}
					<button class:active={weather === w} onclick={() => weather = w}>{w}</button>
				{/each}
			</div>
		</fieldset>

		<!-- Cesium imagery -->
		{#if activeTab === 'cesium' || activeTab === 'compare'}
			<fieldset>
				<legend>Cesium Imagery</legend>
				{#each CESIUM_SOURCES as src (src.id)}
					<label class="source-btn" class:active={cesiumSource === src.id}>
						<input type="radio" name="cesium-src" checked={cesiumSource === src.id} onchange={() => cesiumSource = src.id} />
						<span class="source-name">{src.label}</span>
						<span class="source-note">{src.note}</span>
					</label>
				{/each}
			</fieldset>
		{/if}

		<!-- MapLibre imagery -->
		{#if activeTab === 'maplibre' || activeTab === 'compare'}
			<fieldset>
				<legend>MapLibre Imagery</legend>
				{#each MAPLIBRE_SOURCES as src (src.id)}
					<label class="source-btn" class:active={maplibreSource === src.id}>
						<input type="radio" name="maplibre-src" checked={maplibreSource === src.id} onchange={() => maplibreSource = src.id} />
						<span class="source-name">{src.label}</span>
						<span class="source-note">{src.note}</span>
					</label>
				{/each}
			</fieldset>
			<fieldset>
				<legend>🗄️ Cached (offline tiles)</legend>
				<p class="field-note">Pre-downloaded for dubai / dallas / himalayas — 189 MB total</p>
				{#each CACHED_SOURCES as src (src.id)}
					<label class="source-btn" class:active={maplibreSource === src.id}>
						<input type="radio" name="maplibre-src" checked={maplibreSource === src.id} onchange={() => maplibreSource = src.id} />
						<span class="source-name">{src.label}</span>
						<span class="source-note">{src.note}</span>
					</label>
				{/each}
			</fieldset>
			<fieldset>
				<legend>MapLibre Layers</legend>
				<label class="check"><input type="checkbox" bind:checked={mlAtmosphere} /> Atmosphere + Sky</label>
				<label class="check"><input type="checkbox" bind:checked={mlTerrain} /> 3D Terrain (AWS/JAXA GLO-30)</label>
				<label class="check"><input type="checkbox" bind:checked={mlBuildings} /> 3D Buildings (CartoDB)</label>
			</fieldset>
		{/if}

		<!-- Clouds -->
		<fieldset>
			<legend>Clouds</legend>
			<label>Density <span class="val">{(density * 100).toFixed(0)}%</span>
				<input type="range" bind:value={density} min="0" max="1" step="0.01" />
			</label>
			<label>Drift speed <span class="val">{cloudSpeed.toFixed(1)}×</span>
				<input type="range" bind:value={cloudSpeed} min="0.1" max="3" step="0.1" />
			</label>
		</fieldset>

		<!-- Plane -->
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
		top: 0;
		bottom: 0;
		left: 0;
		right: 0;
	}
	.globe-pane.half { width: 50%; }
	.globe-pane.half.left { left: 0; right: auto; }
	.globe-pane.half.right { left: 50%; right: 0; }

	.cesium-viewer {
		position: absolute;
		inset: 0;
	}

	.cesium-viewer :global(.cesium-viewer-bottom),
	.cesium-viewer :global(.cesium-viewer-toolbar),
	.cesium-viewer :global(.cesium-credit-textContainer),
	.cesium-viewer :global(.cesium-credit-logoContainer) {
		display: none !important;
	}

	.cesium-viewer :global(.cesium-viewer),
	.cesium-viewer :global(.cesium-widget),
	.cesium-viewer :global(.cesium-viewer-cesiumWidgetContainer) {
		width: 100% !important;
		height: 100% !important;
	}

	.cesium-viewer :global(canvas) {
		width: 100% !important;
		height: 100% !important;
	}

	.globe-loading {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: rgba(255, 255, 255, 0.5);
		font: 11px/1 monospace;
		pointer-events: none;
	}

	.compare-divider {
		position: absolute;
		top: 8px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 12px;
		font: 10px/1 monospace;
		color: rgba(255, 255, 255, 0.35);
		pointer-events: none;
		z-index: 10;
	}
	.compare-divider::before {
		content: '';
		position: absolute;
		top: 30px;
		left: 50%;
		width: 1px;
		height: 100vh;
		background: rgba(255, 255, 255, 0.1);
	}

	.horizon-line {
		position: absolute;
		top: 45%;
		left: 0;
		right: 0;
		height: 1px;
		background: rgba(255, 255, 255, 0.12);
		pointer-events: none;
	}

	.hud {
		position: absolute;
		top: 12px;
		right: 12px;
		display: flex;
		gap: 14px;
		align-items: center;
		font: 11px/1 monospace;
		color: rgba(255, 255, 255, 0.55);
		padding: 6px 10px;
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 6px;
		pointer-events: none;
		backdrop-filter: blur(8px);
	}
	.hud b { color: rgba(255, 255, 255, 0.9); font-weight: 600; }

	.sky-tag, .wx-tag {
		padding: 2px 6px;
		border-radius: 3px;
		font-weight: 600;
		letter-spacing: 0.05em;
	}
	.wx-tag {
		background: rgba(255, 255, 255, 0.08);
		color: #ccc;
	}
	.sky-day    { background: rgba(100, 160, 230, 0.25); color: #9ec6f5; }
	.sky-dawn   { background: rgba(230, 120, 80, 0.25);  color: #e09070; }
	.sky-dusk   { background: rgba(200, 100, 70, 0.25);  color: #d68060; }
	.sky-night  { background: rgba(60, 70, 110, 0.4);    color: #8090c0; }

	.val.sky-day   { color: #9ec6f5; }
	.val.sky-dawn  { color: #e09070; }
	.val.sky-dusk  { color: #d68060; }
	.val.sky-night { color: #8090c0; }

	/* Controls panel */
	.controls {
		padding: 20px;
		overflow-y: auto;
		background: #141418;
		border-left: 1px solid #222;
	}
	.controls header h2 {
		margin: 0 0 2px;
		font-size: 17px;
		font-weight: 600;
	}
	.hint {
		margin: 0 0 18px;
		font-size: 11px;
		color: #666;
	}

	.tab-bar {
		display: flex;
		gap: 4px;
		margin-bottom: 16px;
		padding: 3px;
		background: #0e0e12;
		border: 1px solid #222;
		border-radius: 7px;
	}
	.tab-bar button {
		flex: 1;
		padding: 6px 4px;
		background: transparent;
		border: 0;
		border-radius: 4px;
		color: #888;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}
	.tab-bar button:hover { color: #ccc; }
	.tab-bar button.active {
		background: #335577;
		color: #fff;
	}

	fieldset {
		border: 1px solid #222;
		border-radius: 7px;
		padding: 10px 12px 12px;
		margin: 0 0 12px;
		background: #0e0e12;
	}
	legend {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #888;
		padding: 0 6px;
	}

	label {
		display: block;
		font-size: 12px;
		margin-bottom: 8px;
		color: #bbb;
	}
	label:last-child { margin-bottom: 0; }

	.val {
		float: right;
		color: #4488cc;
		font-family: monospace;
		font-size: 11px;
	}

	label.check {
		display: flex;
		gap: 8px;
		align-items: center;
		cursor: pointer;
	}
	label.check input { accent-color: #4488cc; margin: 0; }

	input[type="range"] {
		display: block;
		width: 100%;
		margin-top: 4px;
		accent-color: #4488cc;
	}

	.select {
		display: block;
		width: 100%;
		padding: 6px 8px;
		background: #1a1a1f;
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font-size: 13px;
	}

	.chip-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
	}
	.chip-row.weather-chips {
		grid-template-columns: repeat(3, 1fr);
	}
	.chip-row button {
		padding: 6px 4px;
		background: #1a1a1f;
		border: 1px solid #2a2a30;
		border-radius: 4px;
		color: #aaa;
		font-size: 11px;
		text-transform: capitalize;
		cursor: pointer;
		transition: all 0.15s;
	}
	.chip-row button:hover { background: #22222a; color: #ccc; }
	.chip-row button.active {
		background: #335577;
		border-color: #4488cc;
		color: #fff;
	}

	.source-btn {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 7px 10px;
		border: 1px solid #222;
		border-radius: 5px;
		margin-bottom: 5px;
		cursor: pointer;
		transition: all 0.15s;
	}
	.source-btn:last-child { margin-bottom: 0; }
	.source-btn:hover { border-color: #444; background: #1a1a1f; }
	.source-btn.active {
		border-color: #4488cc;
		background: rgba(68, 136, 204, 0.12);
	}
	.source-btn input { display: none; }
	.source-name { font-size: 12px; font-weight: 500; color: #ddd; }
	.source-note { font-size: 10px; color: #666; }

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.btn {
		padding: 8px;
		background: #1a1a1f;
		border: 1px solid #333;
		border-radius: 5px;
		color: #ccc;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn:hover { background: #22222a; color: #fff; border-color: #444; }
</style>
