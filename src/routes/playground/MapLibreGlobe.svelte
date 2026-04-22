<script lang="ts">
	import { untrack } from 'svelte';
	import {
		MapLibre,
		Projection,
		VectorTileSource,
	} from 'svelte-maplibre-gl';
	import { PMTilesProtocol } from '@svelte-maplibre-gl/pmtiles';
	import type maplibregl from 'maplibre-gl';
	import { buildSatelliteStyle, VOYAGER_STYLE } from './maplibre-style';
	import { type PaletteName } from './palettes';
	import { getSunParams, getSkyPalette } from './lib/sun-palette.svelte';
	import {
		getWaterTime,
		getWaterColor,
		getWaterOpacity,
		getShoreColor,
		getNightWaterColor,
		getNightWaterOpacity,
		hexToRgba
	} from './lib/water-anim.svelte';
	import { globeCamera, getEffectiveZoom, syncCamera } from './lib/globe-camera.svelte';
	import { globeFilters, applyNightFilters } from './lib/globe-filters.svelte';
	import { globeLod, syncLod } from './lib/globe-lod.svelte';
	import { generateFogGeoJSON, generateShadowGeoJSON, generateLocalGridGeoJSON } from './lib/globe-geojson.svelte';

	import AtmosphereLayer from './layers/AtmosphereLayer.svelte';
	import TerrainLayer from './layers/TerrainLayer.svelte';
	import WaterLayer from './layers/WaterLayer.svelte';
	import BuildingLayer from './layers/BuildingLayer.svelte';
	import CityLightsLayer from './layers/CityLightsLayer.svelte';
	import NightLayers from './layers/NightLayers.svelte';
	import LandmarkLayer from './layers/LandmarkLayer.svelte';

	let {
		lat = 25.2,
		lon = 55.3,
		zoom,
		pitch = 45,
		bearing = 0,
		imageryUrl = '',
		imageryAttribution = '',
		pmtilesUrl = '',
		terrainPmtilesUrl = '',
		showBuildings = false,
		showTerrain = false,
		showAtmosphere = true,
		nightFactor = 0,
		timeOfDay = 12,
		paletteName = 'auto' as PaletteName,
		freeCam = false,
		showCityLights = true,
		showLandmarks = true,
		locationId = 'dubai',
		terrainExaggeration = 1.5,
		lodMaxZoomLevels = 6,
		lodTileCountRatio = 2.0,
		mapRef = $bindable<maplibregl.Map | undefined>(undefined),
	}: {
		lat?: number;
		lon?: number;
		zoom?: number;
		pitch?: number;
		bearing?: number;
		imageryUrl?: string;
		imageryAttribution?: string;
		pmtilesUrl?: string;
		terrainPmtilesUrl?: string;
		showBuildings?: boolean;
		showTerrain?: boolean;
		showAtmosphere?: boolean;
		nightFactor?: number;
		timeOfDay?: number;
		paletteName?: PaletteName;
		freeCam?: boolean;
		showCityLights?: boolean;
		showLandmarks?: boolean;
		locationId?: string;
		terrainExaggeration?: number;
		lodMaxZoomLevels?: number;
		lodTileCountRatio?: number;
		mapRef?: maplibregl.Map | undefined;
	} = $props();

	// ── Sync props to module state ──────────────────────────────────────────
	$effect(() => { globeCamera.mapRef = mapRef ?? null; });
	$effect(() => { globeCamera.lat = lat; });
	$effect(() => { globeCamera.lon = lon; });
	$effect(() => { globeCamera.zoom = zoom; });
	$effect(() => { globeCamera.pitch = pitch; });
	$effect(() => { globeCamera.bearing = bearing; });
	$effect(() => { globeCamera.freeCam = freeCam; });

	$effect(() => { globeFilters.mapRef = mapRef ?? null; });
	$effect(() => { globeFilters.nightFactor = nightFactor; });

	$effect(() => { globeLod.mapRef = mapRef ?? null; });
	$effect(() => { globeLod.lodMaxZoomLevels = lodMaxZoomLevels; });
	$effect(() => { globeLod.lodTileCountRatio = lodTileCountRatio; });

	// Sync effects — invoke module functions from component context.
	// These were extracted by the linter into .svelte.ts modules, but
	// $effect requires component context, so we call the sync functions here.
	$effect(() => { syncCamera(); });
	$effect(() => { applyNightFilters(); });
	$effect(() => { syncLod(); });

	// ── Ambient light + sky palette — driven by timeOfDay ───────────────────
	const sunParams = $derived(getSunParams(timeOfDay));
	const skyPalette = $derived(getSkyPalette(timeOfDay, paletteName));

	// ── City light flicker ──────────────────────────────────────────────────
	$effect(() => {
		let raf: number;
		const loop = () => {
			untrack(() => {
				const m = mapRef;
				if (m) {
					try {
						if (m.getLayer?.('city-glow')) {
							const nf = nightFactor;
							const t = getWaterTime();
							const flicker = Math.sin(t * 82) * 0.08 + Math.sin(t * 14.5) * 0.06 + Math.sin(t * 2.5) * 0.04;
							m.setPaintProperty('city-glow', 'circle-opacity', Math.max(0.05, Math.min(1, nf * 0.75 + flicker)));
						}
					} catch {}
				}
			});
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	// ── Water animation derived values ──────────────────────────────────────
	const waterColor = $derived(getWaterColor(getWaterTime(), skyPalette));
	const waterOpacity = $derived(getWaterOpacity(getWaterTime()));
	const shoreColor = $derived(getShoreColor(getWaterTime(), nightFactor));
	const nightWaterColor = $derived(getNightWaterColor(getWaterTime()));
	const nightWaterOpacity = $derived(getNightWaterOpacity(nightFactor, getWaterTime()));
	const buildingNightBrightness = $derived(Math.max(0.15, 1 - nightFactor * 1.5));

	// ── Procedural GeoJSON generators ───────────────────────────────────────
	let shadowTime = $state(0);
	$effect(() => { const id = setInterval(() => { shadowTime += 0.5; }, 500); return () => clearInterval(id); });

	const fogGeoJSON = $derived.by(() => generateFogGeoJSON(lat, lon, 200));
	const shadowGeoJSON = $derived.by(() => generateShadowGeoJSON(lat, lon, shadowTime));
	const localGridGeoJSON = $derived.by(() => generateLocalGridGeoJSON(lat, lon));

	// ── Style ───────────────────────────────────────────────────────────────
	const activeStyle = $derived(
		imageryUrl ? buildSatelliteStyle(imageryUrl, imageryAttribution) :
		pmtilesUrl ? buildSatelliteStyle(`pmtiles://${pmtilesUrl}/{z}/{x}/{y}`, 'PMTiles (cached)') :
		VOYAGER_STYLE
	);
</script>

<MapLibre
	bind:map={mapRef}
	class="map-container"
	center={{ lng: lon, lat }}
	zoom={getEffectiveZoom()}
	{pitch}
	{bearing}
	style={activeStyle}
	attributionControl={false}
	maxPitch={85}
	maxTileCacheSize={200}
	fadeDuration={0}
	autoloadGlobalCss={false}
>
	<!-- DO NOT CHANGE TO MERCATOR — globe projection required for atmosphere + sky -->
	<Projection type="globe" />
	<PMTilesProtocol />

	<AtmosphereLayer
		{showAtmosphere}
		{sunParams}
		{skyPalette}
		{fogGeoJSON}
		{shadowGeoJSON}
		{localGridGeoJSON}
		{hexToRgba}
	/>

	<TerrainLayer {showTerrain} {nightFactor} {terrainExaggeration} {terrainPmtilesUrl} />

	<!-- OpenFreeMap vector tiles — water, buildings, transportation, places. -->
	<VectorTileSource
		id="openmaptiles"
		url="https://tiles.openfreemap.org/planet"
		minzoom={0}
		maxzoom={14}
	>
		<WaterLayer
			{waterColor}
			{waterOpacity}
			{shoreColor}
			{nightWaterColor}
			{nightWaterOpacity}
			{nightFactor}
		/>

		<BuildingLayer {showBuildings} {nightFactor} nightBrightness={buildingNightBrightness} />

		<CityLightsLayer {nightFactor} {showCityLights} />
	</VectorTileSource>

	<!-- Night stack: CartoDB ambient overlays + GeoJSON city/road glow (in VectorTileSource above).
	     Removed NightMaskLayer + NightLightLayer (820 lines of GPU compositing) — the GeoJSON-driven
	     CityLightsLayer is sharper at all zoom levels and cheaper on Pi 5. -->
	<NightLayers {nightFactor} />

	<LandmarkLayer {showLandmarks} {nightFactor} {locationId} />
</MapLibre>

<style>
	:global(.map-container) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
</style>