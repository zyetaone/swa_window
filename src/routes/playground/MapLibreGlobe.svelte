<script lang="ts">
	import {
		MapLibre,
		GlobeControl,
		Sky,
		Light,
		FillExtrusionLayer,
		FillLayer,
		RasterLayer,
		RasterTileSource,
		RasterDEMTileSource,
		Terrain,
		Projection,
		VectorTileSource,
	} from 'svelte-maplibre-gl';
	import { PMTilesProtocol } from '@svelte-maplibre-gl/pmtiles';
	import type maplibregl from 'maplibre-gl';
	import { buildSatelliteStyle, VOYAGER_STYLE, altitudeToZoom } from './maplibre-style';

	let {
		lat = 25.2,
		lon = 55.3,
		altitude = 30000,
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
		/** Time of day 0–24 (drives ambient light position + sky palette). */
		timeOfDay = 12,
		terrainExaggeration = 1.5,
		/**
		 * LOD tuning — `map.setSourceTileLodParams(max, ratio)`. Pi-tuned
		 * defaults: trade a touch of far-distance crispness for ~40% less
		 * tile load at cruise altitude (pitch 70°+).
		 * See https://maplibre.org/maplibre-gl-js/docs/examples/level-of-detail-control/
		 */
		lodMaxZoomLevels = 6,
		lodTileCountRatio = 2.0,
	}: {
		lat?: number;
		lon?: number;
		altitude?: number;
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
		terrainExaggeration?: number;
		lodMaxZoomLevels?: number;
		lodTileCountRatio?: number;
	} = $props();

	// ── Ambient light + sky palette — driven by timeOfDay ───────────────────
	// Artistic model, not astronomically accurate. Goal: "feel" of the hour.
	// Sun follows east-to-west arc 6am→6pm; moon implicit (opposite side) at night.
	const sunParams = $derived.by(() => {
		// hourAngle: -180° at midnight, 0° at noon, 180° at next midnight
		const hourAngle = (timeOfDay - 12) * 15;
		const rad = hourAngle * Math.PI / 180;
		// Elevation: cos() → 1 at noon, -1 at midnight. Map to polar 0..180.
		const elevation = Math.cos(rad);                                // -1..1
		const sunPolar = 90 - elevation * 60;                           // 30 (noon) .. 150 (midnight)
		// Azimuth: 90 (east) at 6am → 180 (south) at noon → 270 (west) at 6pm → 0 (north) at midnight
		const azimuthFrac = ((timeOfDay + 6) / 24) % 1;                 // 0 at 6am → 1 at next 6am
		const sunAzimuth = azimuthFrac * 360;
		return { polar: sunPolar, azimuth: sunAzimuth, elevation };
	});

	// 5-band palette: dawn / morning / noon / dusk / night
	const skyPalette = $derived.by(() => {
		const h = timeOfDay;
		// Dawn (5-7)
		if (h >= 5 && h < 7)  return { sky: '#2a1f4a', horizon: '#e8805a', fog: '#e0a880', light: '#ffd4b8', intensity: 0.55 };
		// Morning (7-10)
		if (h >= 7 && h < 10) return { sky: '#4a7ab5', horizon: '#a0c8e8', fog: '#b8d4ea', light: '#fff1d6', intensity: 0.7 };
		// Day (10-16)
		if (h >= 10 && h < 16) return { sky: '#001e3d', horizon: '#1a4a7a', fog: '#1a3a5c', light: '#fffef2', intensity: 0.8 };
		// Afternoon→Dusk (16-18)
		if (h >= 16 && h < 18) return { sky: '#2c3e75', horizon: '#d4895a', fog: '#c68860', light: '#ffc080', intensity: 0.65 };
		// Dusk / golden hour (18-20)
		if (h >= 18 && h < 20) return { sky: '#1e1a40', horizon: '#c05f40', fog: '#8a4a40', light: '#ff9050', intensity: 0.5 };
		// Twilight (20-22)
		if (h >= 20 && h < 22) return { sky: '#0a0f28', horizon: '#301838', fog: '#1a1432', light: '#7a88d0', intensity: 0.28 };
		// Night (22-5)
		return { sky: '#050510', horizon: '#0a1028', fog: '#0a0f20', light: '#a8b4d0', intensity: 0.2 };
	});

	let mapRef = $state<maplibregl.Map | undefined>(undefined);

	// ── Water shimmer animation clock ───────────────────────────────────────
	// Drives a subtle "breathing" pulse on water fills. Runs at ~30 Hz, far
	// cheaper than per-frame. The shimmer is an artistic fake — Cesium Ion's
	// water is physically animated; ours just suggests motion via color/opacity.
	let waterTime = $state(0);
	$effect(() => {
		let raf: number;
		let last = performance.now();
		const loop = (now: number) => {
			waterTime += (now - last) / 1000;
			last = now;
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	// Time-of-day-aware water: noon navy, golden hour amber, night near-black.
	// Shimmer = sin(t) modulating lightness. Reads as subtle breath over the ocean.
	const waterColor = $derived.by(() => {
		const shimmer = Math.sin(waterTime * 0.6) * 0.5 + 0.5; // 0..1
		const h = timeOfDay;
		// Golden hour (17-19): amber reflection
		if (h >= 17 && h < 19) {
			const r = Math.round(140 + shimmer * 30);
			const g = Math.round(80 + shimmer * 20);
			const b = Math.round(50 + shimmer * 15);
			return `rgba(${r}, ${g}, ${b}, 1)`;
		}
		// Dawn (5-7): rose-blue
		if (h >= 5 && h < 7) {
			return `rgba(${70 + shimmer * 10}, ${50 + shimmer * 10}, ${90 + shimmer * 10}, 1)`;
		}
		// Night (20-5): near-black with cool edge
		if (h >= 20 || h < 5) {
			const b = Math.round(18 + shimmer * 6);
			return `rgba(${4}, ${10 + shimmer * 4}, ${b + 6}, 1)`;
		}
		// Day: muted navy
		const dayB = Math.round(96 + shimmer * 12);
		return `rgba(${32}, ${74 + shimmer * 10}, ${dayB}, 1)`;
	});
	const waterOpacity = $derived(0.35 + Math.sin(waterTime * 0.4) * 0.06);

	// ── LOD control — apply on map-ready and when tunables change ───────────
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

	// ── Camera sync — keep map in sync with reactive props ──────────────────
	// Snapshot reactive values up front (otherwise the effect's tracked reads
	// inside the load callback would be empty on first run).
	let cameraInit = $state(false);
	$effect(() => {
		if (!mapRef) return;
		(window as any).__map = mapRef; // dev debug hook

		const target = { center: [lon, lat] as [number, number], zoom: effectiveZoom, pitch, bearing };

		if (!cameraInit) {
			// First run — force initial camera via jumpTo once the map is ready.
			const apply = () => { mapRef!.jumpTo(target); cameraInit = true; };
			if (mapRef.loaded()) apply();
			else mapRef.once('load', apply);
		} else {
			mapRef.easeTo({ ...target, duration: 200 });
		}
	});

	const activeStyle = $derived(
		imageryUrl ? buildSatelliteStyle(imageryUrl, imageryAttribution, imageryMaxZoom) :
		pmtilesUrl ? buildSatelliteStyle(`pmtiles://${pmtilesUrl}/{z}/{x}/{y}`, 'PMTiles (cached)', imageryMaxZoom) :
		VOYAGER_STYLE
	);
	let nightBrightness = $derived(Math.max(0.2, 1 - nightFactor * 1.3));

	const effectiveZoom = $derived(zoom ?? altitudeToZoom(altitude));

	export function flyTo(dst: { lat: number; lon: number; altitude?: number }, _duration = 2000) {
		if (!mapRef) return;
		const z = dst.altitude ? Math.max(8, altitudeToZoom(dst.altitude)) : effectiveZoom;
		mapRef.flyTo({
			center: [dst.lon, dst.lat],
			zoom: z,
			duration: _duration,
		});
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
	maxPitch={75}
	maxTileCacheSize={200}
	fadeDuration={0}
	autoloadGlobalCss={false}
>
		<Projection type="globe" />
	<PMTilesProtocol />

	{#if showAtmosphere}
		<GlobeControl />
		<!-- Ambient light: position follows sun through the sky, color + intensity
		     match the hour. Shades terrain + extruded buildings realistically. -->
		<Light
			anchor="map"
			position={[1.5, sunParams.azimuth, sunParams.polar]}
			color={skyPalette.light}
			intensity={skyPalette.intensity}
		/>
		<!-- Sky uses map.setSky() — palette driven by timeOfDay (5 bands). -->
		<Sky
			sky-color={skyPalette.sky}
			horizon-color={skyPalette.horizon}
			fog-color={skyPalette.fog}
			sky-horizon-blend={0.3}
			horizon-fog-blend={0.5}
			atmosphere-blend={0.4}
		/>
	{/if}

 	{#if showTerrain}
		<RasterDEMTileSource
			id="terrain"
			tiles={[terrainPmtilesUrl ? `pmtiles://${terrainPmtilesUrl}` : 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp']}
			tileSize={512}
			encoding="terrarium"
			maxzoom={13}
		>
			<Terrain exaggeration={terrainExaggeration} />
		</RasterDEMTileSource>
	{/if}

	{#if showBuildings}
		<!-- OpenFreeMap vector tiles — free, global, no API key. Provides an
		     OpenMapTiles-schema vector source with 'building' + 'water' +
		     'landcover' source-layers. -->
		<VectorTileSource
			id="openmaptiles"
			url="https://tiles.openfreemap.org/planet"
			minzoom={0}
			maxzoom={14}
		>
			<!-- Water — animated color for ocean/lake shimmer (updated by
			     watercolor effect in +page.svelte via setPaintProperty). -->
			<FillLayer
				id="water-shimmer"
				source="openmaptiles"
				sourceLayer="water"
				minzoom={6}
				paint={{
					'fill-color': waterColor,
					'fill-opacity': waterOpacity,
				}}
			/>

			<FillExtrusionLayer
				source="openmaptiles"
				sourceLayer="building"
				minzoom={13}
				filter={['!=', ['get', 'hide_3d'], true]}
				paint={{
					'fill-extrusion-color': nightFactor > 0.5
						? [
							// Night — procedural warm window glow via feature-id hash.
							// feature-state would be cleaner but needs promoteId and
							// a per-tile setFeatureState loop; this is zero-setup.
							'interpolate', ['linear'], ['get', 'render_height'],
							0, `rgba(40, 32, 22, 0.9)`,
							60, `rgba(${80 + nightFactor*40}, ${55 + nightFactor*30}, ${30}, 0.95)`,
							200, `rgba(${140 + nightFactor*50}, ${90 + nightFactor*40}, ${40}, 1.0)`,
							400, `rgba(${180 + nightFactor*30}, ${130 + nightFactor*30}, ${60}, 1.0)`,
						]
						: [
							'interpolate', ['linear'], ['get', 'render_height'],
							0, `rgba(${Math.round(180 * nightBrightness)}, ${Math.round(175 * nightBrightness)}, ${Math.round(165 * nightBrightness)}, 0.85)`,
							200, `rgba(${Math.round(210 * nightBrightness)}, ${Math.round(205 * nightBrightness)}, ${Math.round(195 * nightBrightness)}, 0.95)`,
							400, `rgba(${Math.round(225 * nightBrightness)}, ${Math.round(220 * nightBrightness)}, ${Math.round(210 * nightBrightness)}, 1.0)`,
						],
					'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, ['get', 'render_height']],
					'fill-extrusion-base': ['case', ['>=', ['zoom'], 14], ['get', 'render_min_height'], 0],
					'fill-extrusion-opacity': 0.85,
				}}
			/>
		</VectorTileSource>
	{/if}

	<!-- Night overlay: CartoDB Dark raster composited over satellite as nightFactor rises.
	     When fully night, streets/labels come through dark-styled. Before dawn, fades out.
	     Using the non-@2x URL → tileSize 256 lines up with MapLibre defaults and avoids
	     LOD stripe artifacts visible when @2x (512) is declared as 256. -->
	{#if nightFactor > 0.01}
		<RasterTileSource
			id="night-overlay"
			tiles={['https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png']}
			tileSize={256}
			maxzoom={19}
		>
			<RasterLayer
				id="night-overlay-layer"
				source="night-overlay"
				paint={{
					'raster-opacity': nightFactor * 0.85,
					'raster-fade-duration': 300,
				}}
			/>
		</RasterTileSource>
	{/if}
</MapLibre>

<style>
	:global(.map-container) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
</style>
