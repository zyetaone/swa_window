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
		terrainExaggeration?: number;
		lodMaxZoomLevels?: number;
		lodTileCountRatio?: number;
	} = $props();

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

	// Day ocean: muted navy with sun-glint hint. Night ocean: near-black with
	// cool bioluminescent edge. Shimmer = sin(t) modulating lightness.
	const waterColor = $derived.by(() => {
		const shimmer = Math.sin(waterTime * 0.6) * 0.5 + 0.5; // 0..1
		if (nightFactor > 0.5) {
			const b = Math.round(18 + shimmer * 6);
			return `rgba(${4}, ${10 + shimmer * 4}, ${b + 6}, 1)`;
		}
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
		<Light anchor="map" position={[1.5, 90, 80]} />
		<!-- Sky uses map.setSky() via svelte-maplibre-gl — works with any style. -->
		<Sky
			sky-color={nightFactor > 0.5 ? '#050510' : '#001e3d'}
			horizon-color={nightFactor > 0.5 ? '#0a1028' : '#1a4a7a'}
			fog-color={nightFactor > 0.5 ? '#0a0f20' : '#1a3a5c'}
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
