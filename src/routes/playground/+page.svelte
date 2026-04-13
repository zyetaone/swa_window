<script lang="ts">
	/**
	 * Playground — live sandbox for rendering experiments.
	 *
	 * Compares Cesium and MapLibre globe rendering side-by-side.
	 * Isolated from the main window so we can tweak cloud logic,
	 * test perspective transforms, and wire plane-movement-to-clouds
	 * without breaking the production display route.
	 */

	import type { SkyState } from '$lib/types';
	import CloudBlobs from '$lib/ui/CloudBlobs.svelte';
	import MapLibreGlobe from './MapLibreGlobe.svelte';
	import { onMount } from 'svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import * as Cesium from 'cesium';

	type Tab = 'cesium' | 'maplibre' | 'compare';

	let activeTab = $state<Tab>('cesium');
	let viewerContainer = $state<HTMLDivElement | null>(null);
		let maplibreRef = $state<MapLibreGlobe | null>(null);
	let cesiumViewer: Cesium.Viewer | null = null;
	let cesiumLoaded = $state(false);

	const IMAGERY_SOURCES = [
		{
			id: 'esri',
			label: 'ESRI World Imagery',
			url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
			note: 'No auth, no rate limit, global coverage',
		},
		{
			id: 'mapbox',
			label: 'Mapbox Satellite',
			url: `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${import.meta.env.VITE_MAPBOX_TOKEN ?? ''}`,
			note: 'Requires VITE_MAPBOX_TOKEN env var',
		},
		{
			id: 'sentinel2',
			label: 'Sentinel-2 (RODA)',
			url: 'https://roda.sentinel-hub.com/sentinel-s2-l2a/tiles/{z}/{x}/{y}/L2A/2023-07-15.jpg',
			note: '10m resolution, needs tiling proxy',
		},
		{
			id: 'landsat',
			label: 'Landsat 8 (AWS)',
			url: 'https://landsat-pds.s3.us-west-2.amazonaws.com/tiles/{z}/{x}/{y}.jpg',
			note: '30m resolution, free forever',
		},
	] as const;

	const MAPLIBRE_SOURCES = [
		{
			id: 'eox',
			label: 'Sentinel-2 Cloudless (EOX)',
			url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
			note: 'Free, global, no auth',
		},
		{
			id: 'esri',
			label: 'ESRI World Imagery',
			url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
			note: 'No auth, no rate limit',
		},
	] as const;

	const DUBAI = { lat: 25.2, lon: 55.3, altitude: 50000 };

	// Simulation state — all controlled by sliders
	let density = $state(0.6);
	let speed = $state(1.0);
	let skyState = $state<SkyState>('day');
	let time = $state(0);
	let activeSource = $state('esri');
	let maplibreSource = $state('eox');

	// Plane movement
	let heading = $state(90);
	let planeSpeed = $state(1.0);
	let altitude = $state(30000);
	let windAngle = $state(88);

	// RAF loop
	let raf: number;
	$effect(() => {
		let last = performance.now();
		function loop(now: number) {
			const dt = (now - last) / 1000;
			last = now;
			time += dt * planeSpeed;
			raf = requestAnimationFrame(loop);
		}
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	function initCesium() {
		if (!viewerContainer) return;
		try {
			Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? '';
			cesiumViewer = new Cesium.Viewer(viewerContainer, {
				baseLayer: false,
				animation: false,
				baseLayerPicker: false,
				fullscreenButton: false,
				vrButton: false,
				geocoder: false,
				homeButton: false,
				infoBox: false,
				sceneModePicker: false,
				selectionIndicator: false,
				timeline: false,
				navigationHelpButton: false,
				navigationInstructionsInitiallyVisible: false,
				shadows: false,
				contextOptions: { webgl: { alpha: true, antialias: true } },
			});
			cesiumViewer.imageryLayers.removeAll();
			addImageryLayer(activeSource);
			cesiumLoaded = true;
		} catch (e) {
			console.warn('Cesium init failed:', e);
		}
	}

	function addImageryLayer(sourceId: string) {
		if (!cesiumViewer) return;
		cesiumViewer.imageryLayers.removeAll();
		const src = IMAGERY_SOURCES.find(s => s.id === sourceId);
		if (!src) return;
		try {
			const provider = new Cesium.UrlTemplateImageryProvider({ url: src.url });
			cesiumViewer.imageryLayers.addImageryProvider(provider);
		} catch (e) {
			console.warn(`Failed to load ${sourceId}:`, e);
		}
	}

	function switchSource(id: string) {
		activeSource = id;
		if (cesiumViewer) addImageryLayer(id);
	}

	// Fly to Dubai on Cesium init
	$effect(() => {
		if (cesiumViewer && cesiumLoaded) {
			cesiumViewer.camera.flyTo({
				destination: Cesium.Cartesian3.fromDegrees(DUBAI.lon, DUBAI.lat, DUBAI.altitude),
				orientation: { heading: 0, pitch: -Math.PI / 4, roll: 0 },
			});
		}
	});

	// Fly to Dubai on MapLibre init
	$effect(() => {
		if (activeTab === 'maplibre' && maplibreRef) {
			maplibreRef.flyTo(DUBAI);
		}
	});

	onMount(() => {
		setTimeout(initCesium, 100);
		return () => {
			if (raf) cancelAnimationFrame(raf);
			cesiumViewer?.destroy();
		};
	});

	const skyOptions: SkyState[] = ['day', 'dawn', 'dusk', 'night'];

	const bgGradient = $derived.by(() => {
		switch (skyState) {
			case 'night': return 'linear-gradient(180deg, #0a0a1a 0%, #1a1a2e 50%, #0d0d0d 100%)';
			case 'dawn': return 'linear-gradient(180deg, #2d1b4e 0%, #e07050 40%, #dda060 60%, #3d5a3d 100%)';
			case 'dusk': return 'linear-gradient(180deg, #1a1a3e 0%, #c06040 35%, #ddaa70 55%, #2d3d2d 100%)';
			default: return 'linear-gradient(180deg, #4488cc 0%, #88bbee 30%, #aaddff 50%, #667744 70%, #556633 100%)';
		}
	});

	const activeSourceInfo = $derived(IMAGERY_SOURCES.find(s => s.id === activeSource));
	const activeMapLibreInfo = $derived(MAPLIBRE_SOURCES.find(s => s.id === maplibreSource));
</script>

<div class="playground">
	<div class="viewport" style:background={bgGradient}>
		<!-- Cesium tab -->
		{#if activeTab === 'cesium' || activeTab === 'compare'}
			<div class="globe-pane" class:left-half={activeTab === 'compare'}>
				<div bind:this={viewerContainer} class="cesium-viewer"></div>
			</div>
		{/if}

		<!-- MapLibre tab -->
		{#if activeTab === 'maplibre' || activeTab === 'compare'}
			<div class="globe-pane" class:right-half={activeTab === 'compare'}>
				<MapLibreGlobe
					bind:this={maplibreRef}
					lat={DUBAI.lat}
					lon={DUBAI.lon}
					zoom={10}
					pitch={-45}
					imageryUrl={MAPLIBRE_SOURCES.find(s => s.id === maplibreSource)?.url ?? MAPLIBRE_SOURCES[0].url}
					showAtmosphere={true}
				/>
			</div>
		{/if}

		<CloudBlobs
			{density}
			{speed}
			{skyState}
			{time}
			{heading}
			{altitude}
			{windAngle}
		/>

		{#if activeTab === 'compare'}
			<div class="compare-divider">
				<span>CESIUM</span>
				<span>MAPLIBRE</span>
			</div>
		{/if}

		<div class="horizon-line"></div>
		<div class="hud">
			<span>HDG {heading.toFixed(0)}</span>
			<span>ALT {(altitude / 1000).toFixed(0)}k</span>
			<span>SPD {planeSpeed.toFixed(1)}x</span>
			<span>T {time.toFixed(0)}s</span>
			<span>{skyState.toUpperCase()}</span>
		</div>
	</div>

	<div class="controls">
		<h2>Globe Playground</h2>
		<p class="hint">Compare Cesium vs MapLibre rendering.</p>

		<!-- Tab switcher -->
		<div class="tab-bar">
			<button class:active={activeTab === 'cesium'} onclick={() => activeTab = 'cesium'}>Cesium</button>
			<button class:active={activeTab === 'maplibre'} onclick={() => activeTab = 'maplibre'}>MapLibre</button>
			<button class:active={activeTab === 'compare'} onclick={() => activeTab = 'compare'}>Compare</button>
		</div>

		{#if activeTab === 'cesium' || activeTab === 'compare'}
			<fieldset>
				<legend>Imagery (Cesium)</legend>
				{#each IMAGERY_SOURCES as src (src.id)}
					<label class="source-btn" class:active={activeSource === src.id}>
						<input
							type="radio"
							name="cesium-source"
							value={src.id}
							checked={activeSource === src.id}
							onchange={() => switchSource(src.id)}
						/>
						<span class="source-name">{src.label}</span>
						<span class="source-note">{src.note}</span>
					</label>
				{/each}
				{#if activeSourceInfo}
					<div class="active-info">Active: <strong>{activeSourceInfo.label}</strong></div>
				{/if}
			</fieldset>
		{/if}

		{#if activeTab === 'maplibre' || activeTab === 'compare'}
			<fieldset>
				<legend>Imagery (MapLibre)</legend>
				{#each MAPLIBRE_SOURCES as src (src.id)}
					<label class="source-btn" class:active={maplibreSource === src.id}>
						<input
							type="radio"
							name="maplibre-source"
							value={src.id}
							checked={maplibreSource === src.id}
							onchange={() => maplibreSource = src.id}
						/>
						<span class="source-name">{src.label}</span>
						<span class="source-note">{src.note}</span>
					</label>
				{/each}
				{#if activeMapLibreInfo}
					<div class="active-info">Active: <strong>{activeMapLibreInfo.label}</strong></div>
				{/if}
			</fieldset>
		{/if}

		<fieldset>
			<legend>Clouds</legend>
			<label>
				Density: {(density * 100).toFixed(0)}%
				<input type="range" bind:value={density} min="0" max="1" step="0.01" />
			</label>
			<label>
				Drift Speed: {speed.toFixed(1)}x
				<input type="range" bind:value={speed} min="0.1" max="3" step="0.1" />
			</label>
		</fieldset>

		<fieldset>
			<legend>Plane</legend>
			<label>
				Heading: {heading.toFixed(0)} deg
				<input type="range" bind:value={heading} min="0" max="360" step="1" />
			</label>
			<label>
				Speed: {planeSpeed.toFixed(1)}x
				<input type="range" bind:value={planeSpeed} min="0.1" max="5" step="0.1" />
			</label>
			<label>
				Altitude: {(altitude / 1000).toFixed(0)}k ft
				<input type="range" bind:value={altitude} min="5000" max="45000" step="1000" />
			</label>
		</fieldset>

		<fieldset>
			<legend>Sky</legend>
			<div class="sky-buttons">
				{#each skyOptions as opt (opt)}
					<button
						class:active={skyState === opt}
						onclick={() => skyState = opt}
					>{opt}</button>
				{/each}
			</div>
		</fieldset>
	</div>
</div>

<style>
	.playground {
		display: grid;
		grid-template-columns: 1fr 340px;
		height: 100vh;
		background: #111;
		color: #eee;
		font-family: system-ui, -apple-system, sans-serif;
	}

	.viewport {
		position: relative;
		overflow: hidden;
		border-right: 1px solid #333;
	}

	.globe-pane {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 100%;
	}

	.globe-pane.right-half {
		left: 50%;
		width: 50%;
	}

	.globe-pane.left-half {
		width: 50%;
	}

	.cesium-viewer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.cesium-viewer :global(.cesium-viewer-bottom),
	.cesium-viewer :global(.cesium-viewer-toolbar),
	.cesium-viewer :global(.cesium-credit-textContainer),
	.cesium-viewer :global(.cesium-credit-logoContainer) {
		display: none !important;
	}

	.cesium-viewer :global(canvas) {
		width: 100% !important;
		height: 100% !important;
	}

	.compare-divider {
		position: absolute;
		left: 50%;
		top: 8px;
		transform: translateX(-50%);
		display: flex;
		gap: 24px;
		font: 10px/1 monospace;
		color: rgba(255, 255, 255, 0.3);
		pointer-events: none;
		z-index: 10;
	}

	.horizon-line {
		position: absolute;
		top: 45%;
		left: 0;
		right: 0;
		height: 1px;
		background: rgba(255, 255, 255, 0.15);
		pointer-events: none;
	}

	.hud {
		position: absolute;
		top: 12px;
		right: 12px;
		display: flex;
		gap: 16px;
		font: 11px/1 monospace;
		color: rgba(255, 255, 255, 0.5);
		pointer-events: none;
	}

	.controls {
		padding: 20px;
		overflow-y: auto;
		background: #1a1a1a;
	}

	.controls h2 {
		margin: 0 0 4px;
		font-size: 18px;
		font-weight: 600;
	}

	.hint {
		margin: 0 0 20px;
		font-size: 12px;
		color: #666;
	}

	.tab-bar {
		display: flex;
		gap: 6px;
		margin-bottom: 20px;
	}

	.tab-bar button {
		flex: 1;
		padding: 8px 4px;
		background: #222;
		border: 1px solid #444;
		border-radius: 6px;
		color: #888;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.tab-bar button:hover {
		background: #2a2a2a;
		color: #ccc;
	}

	.tab-bar button.active {
		background: #335577;
		border-color: #4488cc;
		color: #fff;
	}

	fieldset {
		border: 1px solid #333;
		border-radius: 8px;
		padding: 12px;
		margin: 0 0 16px;
	}

	legend {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #888;
		padding: 0 6px;
	}

	label {
		display: block;
		font-size: 13px;
		margin-bottom: 10px;
		color: #ccc;
	}

	input[type="range"] {
		display: block;
		width: 100%;
		margin-top: 4px;
		accent-color: #4488cc;
	}

	.sky-buttons {
		display: flex;
		gap: 8px;
	}

	.sky-buttons button {
		flex: 1;
		padding: 8px;
		background: #2a2a2a;
		border: 1px solid #444;
		border-radius: 6px;
		color: #ccc;
		font-size: 12px;
		text-transform: capitalize;
		cursor: pointer;
		transition: all 0.15s;
	}

	.sky-buttons button:hover {
		background: #333;
	}

	.sky-buttons button.active {
		background: #335577;
		border-color: #4488cc;
		color: #fff;
	}

	.source-btn {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 10px;
		border: 1px solid #333;
		border-radius: 6px;
		margin-bottom: 6px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.source-btn:hover {
		border-color: #555;
		background: #222;
	}

	.source-btn.active {
		border-color: #4488cc;
		background: rgba(68, 136, 204, 0.15);
	}

	.source-btn input {
		display: none;
	}

	.source-name {
		font-size: 13px;
		font-weight: 500;
		color: #ddd;
	}

	.source-note {
		font-size: 11px;
		color: #666;
	}

	.active-info {
		margin-top: 8px;
		padding: 8px;
		background: #222;
		border-radius: 4px;
		font-size: 12px;
		color: #aaa;
	}

	.active-info strong {
		color: #4488cc;
	}
</style>