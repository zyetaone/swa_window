<script lang="ts">
	import { untrack } from 'svelte';
	import {
		MapLibre,
		Projection,
		VectorTileSource,
	} from 'svelte-maplibre-gl';
	import { PMTilesProtocol } from '@svelte-maplibre-gl/pmtiles';
	import type maplibregl from 'maplibre-gl';
	import { buildSatelliteStyle, VOYAGER_STYLE, altitudeToZoom } from './maplibre-style';
	import { PALETTES, type PaletteName } from './palettes';

	import AtmosphereLayer from './layers/AtmosphereLayer.svelte';
	import TerrainLayer from './layers/TerrainLayer.svelte';
	import WaterLayer from './layers/WaterLayer.svelte';
	import BuildingLayer from './layers/BuildingLayer.svelte';
	import CityLightsLayer from './layers/CityLightsLayer.svelte';
	import NightMaskLayer from './layers/NightMaskLayer.svelte';
	import NightLightLayer from './layers/NightLightLayer.svelte';
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
		imageryMaxZoom = 14,
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
		imageryMaxZoom?: number;
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

	// ── Ambient light + sky palette — driven by timeOfDay ───────────────────
	const sunParams = $derived.by(() => {
		const sunAzimuth = (timeOfDay * 15) % 360;
		const hourAngle = (timeOfDay - 12) * 15;
		const elevation = Math.cos(hourAngle * Math.PI / 180);
		const sunPolar = 90 - elevation * 60;
		return { polar: sunPolar, azimuth: sunAzimuth, elevation };
	});

	// 5-band palette: dawn / morning / noon / dusk / night
	type Band = { sky: string; horizon: string; fog: string; light: string; intensity: number; water: { r: number; g: number; b: number } };
	const BANDS: [number, number, Band][] = [
		[5,  7,  { sky: '#2a1f4a', horizon: '#e8805a', fog: '#d8b898', light: '#ffd4b8', intensity: 0.55, water: { r: 70, g: 50, b: 90 } }],
		[7,  10, { sky: '#4a7ab5', horizon: '#d0e0f0', fog: '#dce8f2', light: '#fff1d6', intensity: 0.7,  water: { r: 50, g: 92, b: 130 } }],
		[10, 16, { sky: '#1a4a80', horizon: '#c8daf0', fog: '#b0c8e0', light: '#fffef2', intensity: 0.8,  water: { r: 32, g: 74, b: 96 } }],
		[16, 18, { sky: '#2c3e75', horizon: '#d4895a', fog: '#c68860', light: '#ffc080', intensity: 0.65, water: { r: 100, g: 90, b: 90 } }],
		[18, 20, { sky: '#1e1a40', horizon: '#c05f40', fog: '#8a4a40', light: '#ff9050', intensity: 0.5,  water: { r: 130, g: 75, b: 50 } }],
		[20, 22, { sky: '#0a0f28', horizon: '#301838', fog: '#1a1432', light: '#7a88d0', intensity: 0.28, water: { r: 10, g: 18, b: 35 } }],
	];
	const NIGHT_BAND: Band = { sky: '#050510', horizon: '#0a1028', fog: '#0a0f20', light: '#a8b4d0', intensity: 0.2, water: { r: 4, g: 14, b: 24 } };

	const skyPalette = $derived.by(() => {
		if (paletteName !== 'auto' && PALETTES[paletteName]) return PALETTES[paletteName];
		const h = timeOfDay;
		for (const [lo, hi, band] of BANDS) { if (h >= lo && h < hi) return band; }
		return NIGHT_BAND;
	});

	// ── Single RAF for water shimmer + city light flicker ────────────────────
	let waterTime = $state(0);
	$effect(() => {
		let raf: number;
		let last = performance.now();
		const loop = (now: number) => {
			untrack(() => {
				const dt = Math.min((now - last) / 1000, 0.1);
				last = now;
				waterTime += dt;

				const m = mapRef;
				if (m) {
					try {
						if (m.getLayer?.('city-glow')) {
							const nf = nightFactor;
							const t = waterTime;
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

	// ── Water animation derived values (passed to WaterLayer) ───────────────
	const waterColor = $derived.by(() => {
		const shimmer = Math.sin(waterTime * 0.6) * 0.5 + 0.5;
		const w = skyPalette.water;
		const r = Math.round(w.r + shimmer * 10);
		const g = Math.round(w.g + shimmer * 10);
		const b = Math.round(w.b + shimmer * 12);
		return `rgba(${r}, ${g}, ${b}, 1)`;
	});
	const waterOpacity = $derived(0.35 + Math.sin(waterTime * 0.4) * 0.06);

	const shoreColor = $derived.by(() => {
		const wave = Math.sin(waterTime * 1.2) * 0.5 + 0.5;
		if (nightFactor > 0.5) {
			const b = Math.round(80 + wave * 40);
			return `rgba(${60 + Math.round(wave * 20)}, ${70 + Math.round(wave * 25)}, ${b}, 0.7)`;
		}
		const r = Math.round(180 + wave * 75);
		const g = Math.round(210 + wave * 45);
		const b = Math.round(220 + wave * 35);
		return `rgba(${r}, ${g}, ${b}, 0.6)`;
	});

	const nightWaterColor = $derived.by(() => {
		const pulse = Math.sin(waterTime * 0.5) * 0.5 + 0.5;
		const a = Math.round(55 + pulse * 40);
		return `rgba(255, 190, 100, ${(a / 255).toFixed(3)})`;
	});
	const nightWaterOpacity = $derived(nightFactor * 0.45 + Math.sin(waterTime * 0.5) * 0.06);

	function hexToRgba(hex: string, alpha: number) {
		const r = parseInt(hex.slice(1, 3), 16) || 255;
		const g = parseInt(hex.slice(3, 5), 16) || 255;
		const b = parseInt(hex.slice(5, 7), 16) || 255;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	// ── Procedural GeoJSON generators ───────────────────────────────────────
	const pt = (coords: [number, number], props = {}) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: coords }, properties: props });
	const fc = (features: any[]) => ({ type: 'FeatureCollection' as const, features });

	const fogGeoJSON = $derived.by(() => fc(
		Array.from({ length: 200 }, () => pt([lon + (Math.random() - 0.5) * 0.8, lat + (Math.random() - 0.5) * 0.8], { weight: Math.random() * 0.5 + 0.5 }))
	));

	let shadowTime = $state(0);
	// Throttled to 2Hz — cloud shadows drift slowly, no need for 10Hz GeoJSON rebuilds
	$effect(() => { const id = setInterval(() => { shadowTime += 0.5; }, 500); return () => clearInterval(id); });

	const shadowGeoJSON = $derived.by(() => fc(
		Array.from({ length: 25 }, (_, i) => {
			const sx = ((i * 0.741) % 1 + shadowTime * 0.05) % 1;
			return pt([lon + (sx - 0.5) * 2.0, lat + (((i * 0.312) % 1) - 0.5) * 2.0]);
		})
	));

	const localGridGeoJSON = $derived.by(() => {
		void locationId;
		const [step, span] = [0.05, 1.0];
		const [cLat, cLon] = [Math.round(lat), Math.round(lon)];
		const line = (c: [number, number][]) => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: c }, properties: {} });
		const features = [];
		for (let y = cLat - span; y <= cLat + span; y += step) features.push(line([[cLon - span, y], [cLon + span, y]]));
		for (let x = cLon - span; x <= cLon + span; x += step) features.push(line([[x, cLat - span], [x, cLat + span]]));
		return fc(features);
	});

	// ── LOD control ─────────────────────────────────────────────────────────
	$effect(() => {
		if (!mapRef) return;
		const apply = () => {
			try {
				(mapRef as any).setSourceTileLodParams?.(lodMaxZoomLevels, lodTileCountRatio);
			} catch (e) {
				console.warn('[MapLibre] setSourceTileLodParams failed:', e);
			}
		};
		if (mapRef.loaded()) apply();
		else mapRef.once('load', apply);
	});

	// ── Camera sync ─────────────────────────────────────────────────────────
	let cameraInit = false;
	let prevTarget = { lat: 0, lon: 0 };
	// Fixed cruise zoom — altitude affects cloud behavior, not map zoom.
	// A passenger's field of view through the window doesn't change when
	// the plane climbs or descends. Zoom ~10.5 gives good terrain detail
	// at cruise altitude with visible city layout + coastlines.
	const effectiveZoom = $derived(zoom ?? 10.5);

	$effect(() => {
		if (!mapRef) return;
		if (import.meta.env.DEV) (window as any).__map = mapRef;

		const target = { center: [lon, lat] as [number, number], zoom: effectiveZoom, pitch, bearing };

		if (!cameraInit) {
			const apply = () => {
				mapRef!.jumpTo(target);
				mapRef!.setPitch(pitch);
				mapRef!.setBearing(bearing);
				cameraInit = true;
			};
			if (mapRef.isStyleLoaded()) apply();
			else mapRef.once('idle', apply);
			prevTarget = { lat, lon };
			return;
		}
		if (freeCam) return;

		const distSq = Math.pow(lat - prevTarget.lat, 2) + Math.pow(lon - prevTarget.lon, 2);
		// Threshold detects location teleports (>0.001) vs smooth orbital drift.
		// Orbital RAF updates are tiny increments → jumpTo. Location changes → cinematic easeTo.
		if (distSq > 0.001) {
			mapRef.stop();
			mapRef.easeTo({ ...target, duration: 2500 });
		} else {
			mapRef.jumpTo(target);
		}
		prevTarget = { lat, lon };
	});

	// ── Style + night dimming ───────────────────────────────────────────────
	const activeStyle = $derived(
		imageryUrl ? buildSatelliteStyle(imageryUrl, imageryAttribution, imageryMaxZoom) :
		pmtilesUrl ? buildSatelliteStyle(`pmtiles://${pmtilesUrl}/{z}/{x}/{y}`, 'PMTiles (cached)', imageryMaxZoom) :
		VOYAGER_STYLE
	);

	const baseBrightness = $derived(1.0 - (nightFactor * 0.92));
	const baseSaturation = $derived(1.0 - (nightFactor * 0.82));
	const baseContrast = $derived(1.0 + nightFactor * 0.6);

	$effect(() => {
		if (!mapRef) return;
		const m = mapRef;
		const applyFilters = () => {
			try {
				if (m.getLayer('sat-imagery')) {
					m.setPaintProperty('sat-imagery', 'raster-brightness-max', baseBrightness);
					m.setPaintProperty('sat-imagery', 'raster-brightness-min', nightFactor > 0.5 ? 0.02 : 0.08);
					m.setPaintProperty('sat-imagery', 'raster-saturation', baseSaturation - 1);
					m.setPaintProperty('sat-imagery', 'raster-contrast', baseContrast - 1);
				}
			} catch(e) {
				console.warn('Failed to apply night filters to base layer', e);
			}
		};
		if (mapRef.loaded() && mapRef.isStyleLoaded()) applyFilters();
		else {
			mapRef.once('load', applyFilters);
			mapRef.once('styledata', applyFilters);
		}
	});

	const nightBrightness = $derived(Math.max(0.15, 1 - nightFactor * 1.5));

	export function flyTo(dst: { lat: number; lon: number; altitude?: number }, _duration = 2000) {
		if (!mapRef) return;
		const z = dst.altitude ? Math.max(8, altitudeToZoom(dst.altitude)) : effectiveZoom;
		mapRef.flyTo({ center: [dst.lon, dst.lat], zoom: z, duration: _duration });
	}
</script>

<MapLibre
	bind:map={mapRef}
	class="map-container"
	center={{ lng: lon, lat }}
	zoom={effectiveZoom}
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

		<BuildingLayer {showBuildings} {nightFactor} {nightBrightness} />

		<CityLightsLayer {nightFactor} {showCityLights} />
	</VectorTileSource>

	<NightLightLayer {timeOfDay} {locationId} />
	<NightMaskLayer {timeOfDay} />
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
