<script lang="ts">
	import {
		MapLibre,
		GlobeControl,
		Sky,
		Light,
		CircleLayer,
		FillExtrusionLayer,
		FillLayer,
		GeoJSONSource,
		HillshadeLayer,
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
	import { PALETTES, type PaletteName } from './palettes';
	import { landmarksFor } from './lib/landmarks';

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
		/** Creative palette override. 'auto' uses time-driven 5-band palette. */
		paletteName = 'auto' as PaletteName,
		/** When true, user can drag/zoom/pitch the map freely; prop-driven
		    camera sync is disabled after the first frame. */
		freeCam = false,
		/** Show procedural city-light glow at night (driven by OpenMapTiles
		    `place` source-layer points). Free, no external data. */
		showCityLights = true,
		/** Show curated landmarks for the current location. GeoJSON-driven. */
		showLandmarks = true,
		/** Current location id — used to filter the curated landmarks layer. */
		locationId = 'dubai',
		terrainExaggeration = 1.5,
		/**
		 * LOD tuning — `map.setSourceTileLodParams(max, ratio)`. Pi-tuned
		 * defaults: trade a touch of far-distance crispness for ~40% less
		 * tile load at cruise altitude (pitch 70°+).
		 * See https://maplibre.org/maplibre-gl-js/docs/examples/level-of-detail-control/
		 */
		lodMaxZoomLevels = 6,
		lodTileCountRatio = 2.0,
		/** Bindable — exposes the underlying maplibregl.Map to parents (used
		    by ThreeBillboards + other custom overlays). */
		mapRef = $bindable<maplibregl.Map | undefined>(undefined),
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
	// MapLibre Light spec:
	//   position: [radial, azimuthal°, polar°]
	//   azimuth 0=N, 90=E, 180=S, 270=W  (compass-like, clockwise from north)
	//   polar   0=zenith (directly above), 90=horizon, 180=below
	//   radial  distance from center; docs default 1.15.
	//   https://maplibre.org/maplibre-style-spec/light/
	//
	// Artistic sun-path model: east-to-south-to-west arc across the day.
	const sunParams = $derived.by(() => {
		// Azimuth: 0h=N, 6h=E(90°), 12h=S(180°), 18h=W(270°), 24h=N
		const sunAzimuth = (timeOfDay * 15) % 360;
		// Polar: cos-based elevation gives 30° at noon (steep light from up/south)
		// to 150° at midnight (below horizon — not rendered, but drives intensity).
		const hourAngle = (timeOfDay - 12) * 15;
		const elevation = Math.cos(hourAngle * Math.PI / 180);           // -1..1
		const sunPolar = 90 - elevation * 60;                            // 30..150
		return { polar: sunPolar, azimuth: sunAzimuth, elevation };
	});

	// 5-band palette: dawn / morning / noon / dusk / night
	// If paletteName is a named preset (not 'auto'), it locks the mood.
	const skyPalette = $derived.by(() => {
		if (paletteName !== 'auto' && PALETTES[paletteName]) {
			return PALETTES[paletteName];
		}
		const h = timeOfDay;
		// Dawn (5-7)
		if (h >= 5 && h < 7)  return { sky: '#2a1f4a', horizon: '#e8805a', fog: '#e0a880', light: '#ffd4b8', intensity: 0.55, water: { r: 70, g: 50, b: 90 } };
		// Morning (7-10)
		if (h >= 7 && h < 10) return { sky: '#4a7ab5', horizon: '#a0c8e8', fog: '#b8d4ea', light: '#fff1d6', intensity: 0.7,  water: { r: 50, g: 92, b: 130 } };
		// Day (10-16)
		if (h >= 10 && h < 16) return { sky: '#001e3d', horizon: '#1a4a7a', fog: '#1a3a5c', light: '#fffef2', intensity: 0.8,  water: { r: 32, g: 74, b: 96 } };
		// Afternoon→Dusk (16-18)
		if (h >= 16 && h < 18) return { sky: '#2c3e75', horizon: '#d4895a', fog: '#c68860', light: '#ffc080', intensity: 0.65, water: { r: 100, g: 90, b: 90 } };
		// Dusk / golden hour (18-20)
		if (h >= 18 && h < 20) return { sky: '#1e1a40', horizon: '#c05f40', fog: '#8a4a40', light: '#ff9050', intensity: 0.5,  water: { r: 130, g: 75, b: 50 } };
		// Twilight (20-22)
		if (h >= 20 && h < 22) return { sky: '#0a0f28', horizon: '#301838', fog: '#1a1432', light: '#7a88d0', intensity: 0.28, water: { r: 10, g: 18, b: 35 } };
		// Night (22-5)
		return { sky: '#050510', horizon: '#0a1028', fog: '#0a0f20', light: '#a8b4d0', intensity: 0.2, water: { r: 4, g: 14, b: 24 } };
	});

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

	// Water color derives from the active palette's water band with a shimmer
	// modulation. Named palette locks water; auto tracks time-of-day.
	const waterColor = $derived.by(() => {
		const shimmer = Math.sin(waterTime * 0.6) * 0.5 + 0.5; // 0..1
		const w = skyPalette.water;
		const r = Math.round(w.r + shimmer * 10);
		const g = Math.round(w.g + shimmer * 10);
		const b = Math.round(w.b + shimmer * 12);
		return `rgba(${r}, ${g}, ${b}, 1)`;
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
	// Always enforce tilted cruise-view (pitch) on load — svelte-maplibre-gl's
	// initial pitch prop can be overridden by map reinitialization, leaving
	// us stuck top-down. Listen for 'idle' (fired after style + sources settle)
	// to explicitly setPitch + setBearing + setZoom after initial render.
	let cameraInit = false;
	let prevTarget = { lat: 0, lon: 0 };
	$effect(() => {
		if (!mapRef) return;
		(window as any).__map = mapRef; // dev debug hook

		const target = { center: [lon, lat] as [number, number], zoom: effectiveZoom, pitch, bearing };

		if (!cameraInit) {
			const apply = () => {
				mapRef!.jumpTo(target);
				// Belt-and-braces — force pitch/bearing even if jumpTo was racy
				mapRef!.setPitch(pitch);
				mapRef!.setBearing(bearing);
				cameraInit = true;
			};
			// 'idle' fires after style + all sources settle; more reliable than 'load'
			if (mapRef.isStyleLoaded()) apply();
			else mapRef.once('idle', apply);
			prevTarget = { lat, lon };
			return;
		}
		if (freeCam) return;       // user-controlled: don't override

		const distSq = Math.pow(lat - prevTarget.lat, 2) + Math.pow(lon - prevTarget.lon, 2);
		// Threshold to detect "teleports" (UI location changes) vs "smooth flight" (RAF updates)
		if (distSq > 0.001) {
			mapRef.easeTo({ ...target, duration: 2500 }); // nice cinematic sweep for jumps
		} else {
			mapRef.jumpTo(target);
		}
		prevTarget = { lat, lon };
	});

	const activeStyle = $derived(
		imageryUrl ? buildSatelliteStyle(imageryUrl, imageryAttribution, imageryMaxZoom) :
		pmtilesUrl ? buildSatelliteStyle(`pmtiles://${pmtilesUrl}/{z}/{x}/{y}`, 'PMTiles (cached)', imageryMaxZoom) :
		VOYAGER_STYLE
	);

	// Sync imagery base layer: dim + desaturate as night falls (mimics Cesium BASE_NIGHT_BRIGHTNESS)
	const baseBrightness = $derived(1.0 - (nightFactor * 0.85)); // Down to 0.15 at full night
	const baseSaturation = $derived(1.0 - (nightFactor * 0.75)); // Down to 0.25 at full night
	
	$effect(() => {
		if (!mapRef) return;
		const m = mapRef;  // capture for closure — TS narrow

		const applyFilters = () => {
			try {
				// Apply these filters directly to the satellite layer to avoid entire style re-renders
				if (m.getLayer('sat-imagery')) {
					m.setPaintProperty('sat-imagery', 'raster-brightness-max', baseBrightness);
					m.setPaintProperty('sat-imagery', 'raster-saturation', baseSaturation - 1); // mapbox/maplibre uses -1 to 1 where -1 is grayscale
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

	let nightBrightness = $derived(Math.max(0.15, 1 - nightFactor * 1.5));

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
	maxPitch={85}
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
			position={[1.15, sunParams.azimuth, sunParams.polar]}
			color={skyPalette.light}
			intensity={skyPalette.intensity}
		/>
		<!-- Sky — all atmosphere properties per MapLibre sky spec.
		     atmosphere-blend is zoom-interpolated: strong atmosphere scattering
		     at low zoom (globe view), fading as we descend closer to terrain.
		     Matches hybrid-satellite + sky-fog-terrain examples. -->
		<Sky
			sky-color={skyPalette.sky}
			horizon-color={skyPalette.horizon}
			fog-color={skyPalette.fog}
			sky-horizon-blend={0.8}
			horizon-fog-blend={0.9}
			fog-ground-blend={0.5}
			atmosphere-blend={['interpolate', ['linear'], ['zoom'], 0, 1.0, 8, 0.8, 14, 0.4]}
		/>
	{/if}

 	{#if showTerrain}
		<!-- Mapterhorn terrain via tilejson (self-describing — encoding,
		     zoom range, attribution come from the URL). Matches the MapLibre
		     hybrid-satellite-with-terrain example. -->
		<!-- Tilesize per Mapterhorn's tilejson response (512). Omitting the
		     prop lets MapLibre read it from the tilejson metadata. -->
		<RasterDEMTileSource
			id="terrain"
			url={terrainPmtilesUrl ? `pmtiles://${terrainPmtilesUrl}` : 'https://tiles.mapterhorn.com/tilejson.json'}
		>
			<Terrain exaggeration={terrainExaggeration} />
		</RasterDEMTileSource>

		<!-- Hillshade — second raster-dem reference renders a shaded-relief
		     pass that gives terrain real directional shadows. -->
		<RasterDEMTileSource
			id="hillshade"
			url="https://tiles.mapterhorn.com/tilejson.json"
		>
			<HillshadeLayer
				id="hillshade-layer"
				source="hillshade"
				paint={{
					'hillshade-shadow-color': nightFactor > 0.5 ? '#1a1f35' : '#473B24',
					'hillshade-highlight-color': nightFactor > 0.5 ? '#4a5a7a' : '#ffe8c0',
					'hillshade-accent-color': nightFactor > 0.5 ? '#2a3048' : '#8a6040',
					'hillshade-exaggeration': 0.5,
				}}
			/>
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
					// MapLibre expr spec: 'zoom' must be input to a top-level step / interpolate
					'fill-extrusion-base': ['step', ['zoom'], 0, 14, ['get', 'render_min_height']],
					'fill-extrusion-opacity': 0.85,
				}}
			/>
		</VectorTileSource>
	{/if}

	<!-- VIIRS Black Marble — NASA's global earth-at-night composite, the
	     actual satellite observation of city lights. Rendered BELOW the
	     CartoDB emission layer so bright city regions (Dubai, Dallas, etc.)
	     light up based on real data; dark regions (ocean, desert) stay
	     faithful to the dimmed satellite underneath.
	     GIBS tile URL: https://nasa-gibs.github.io/gibs-api-docs/
	     Fixed date 2016-01-01 gives a stable annual composite. -->
	{#if nightFactor > 0.01}
		<RasterTileSource
			id="viirs-nightlights"
			tiles={['https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png']}
			tileSize={256}
			maxzoom={8}
		>
			<RasterLayer
				id="viirs-layer"
				source="viirs-nightlights"
				paint={{
					'raster-opacity': nightFactor * 0.85,
					'raster-fade-duration': 300,
					// Boost the yellow/amber tint already in the VIIRS imagery
					'raster-hue-rotate': 10,
					'raster-saturation': 0.3,
					'raster-brightness-max': 1.4 + nightFactor * 0.3,
					'raster-contrast': 0.25,
				}}
			/>
		</RasterTileSource>
	{/if}

	<!-- CartoDB as emission overlay — streets/buildings/labels glow warm.
	     Sits ABOVE the VIIRS layer so the street network is visible as
	     structure even over the bright VIIRS-lit city cores. -->
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
					'raster-opacity': nightFactor * 0.9,
					'raster-fade-duration': 300,
					// Crank contrast so dark bg stays dark, lighter streets pop
					'raster-contrast': 0.3 + (nightFactor * 0.4),
					// Let the lighter pixels (streets/buildings/labels) blow out —
					// they become the bright glow highlights
					'raster-brightness-min': 0,
					'raster-brightness-max': 1.0 + (nightFactor * 1.0),
					// Rotate the cool gray/blue of CartoDB toward warm amber (~+40°)
					'raster-hue-rotate': nightFactor * 40,
					// And inject some saturation so the hue rotation actually shows
					'raster-saturation': -0.2 + nightFactor * 0.5,
				}}
			/>
		</RasterTileSource>

		<!-- Labeled variant on TOP (gives us labels glowing too) at low opacity.
		     The dark_all style includes street/POI labels — they become lit
		     signs at night through the same brightness-max boost. -->
		<RasterTileSource
			id="night-labels"
			tiles={['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png']}
			tileSize={256}
			maxzoom={19}
		>
			<RasterLayer
				id="night-labels-layer"
				source="night-labels"
				paint={{
					'raster-opacity': nightFactor * 0.35,
					'raster-fade-duration': 300,
					'raster-brightness-min': 0.1,
					'raster-brightness-max': 1.8 + nightFactor * 0.6,
					'raster-hue-rotate': 30,
					'raster-saturation': 0.4,
					'raster-contrast': 0.35,
				}}
			/>
		</RasterTileSource>
	{/if}

	<!-- Procedural city-light glow: CircleLayer on OpenMapTiles 'place' source-
	     layer. Every city/town/village is a POINT feature with a `rank` attribute
	     (1 = world-class city, higher = smaller). Render as a warm blurred disc
	     sized by rank, opacity driven by nightFactor. Zero cost — lives on the
	     existing openmaptiles vector source (added for buildings). -->
	{#if showBuildings && showCityLights && nightFactor > 0.15}
		<CircleLayer
			id="city-glow"
			source="openmaptiles"
			sourceLayer="place"
			minzoom={4}
			filter={['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'village']]]}
			paint={{
				'circle-color': '#ffd480',
				'circle-radius': [
					'interpolate', ['linear'], ['zoom'],
					4, ['case', ['<=', ['get', 'rank'], 3], 4, ['<=', ['get', 'rank'], 6], 2, 1],
					10, ['case', ['<=', ['get', 'rank'], 3], 14, ['<=', ['get', 'rank'], 6], 8, 4],
					14, ['case', ['<=', ['get', 'rank'], 3], 28, ['<=', ['get', 'rank'], 6], 18, 10],
				],
				'circle-blur': 1.2,
				'circle-opacity': nightFactor * 0.75,
			}}
		/>
	{/if}

	<!-- Curated landmarks — GeoJSON POIs per location, glowing warmly at night.
	     Each feature has `rank` (1=hero..3=secondary) driving radius + opacity.
	     Two stacked circle layers per point: outer soft halo + inner hot core. -->
	{#if showLandmarks}
		<GeoJSONSource id="landmarks" data={landmarksFor(locationId)}>
			<CircleLayer
				id="landmark-halo"
				source="landmarks"
				minzoom={5}
				paint={{
					'circle-color': nightFactor > 0.3 ? '#ffc878' : '#f0e4c8',
					'circle-radius': [
						'interpolate', ['linear'], ['zoom'],
						5,  ['match', ['get', 'rank'], 1, 6,  2, 4,  3, 2, 2],
						10, ['match', ['get', 'rank'], 1, 26, 2, 18, 3, 10, 10],
						14, ['match', ['get', 'rank'], 1, 60, 2, 40, 3, 22, 22],
					],
					'circle-blur': 1.6,
					'circle-opacity': 0.35 + nightFactor * 0.45,
				}}
			/>
			<CircleLayer
				id="landmark-core"
				source="landmarks"
				minzoom={5}
				paint={{
					'circle-color': nightFactor > 0.3 ? '#fff2c4' : '#ffffff',
					'circle-radius': [
						'interpolate', ['linear'], ['zoom'],
						5,  ['match', ['get', 'rank'], 1, 2,  2, 1.5,  3, 1, 1],
						10, ['match', ['get', 'rank'], 1, 7,  2, 5,    3, 3, 3],
						14, ['match', ['get', 'rank'], 1, 16, 2, 12,   3, 7, 7],
					],
					'circle-blur': 0.3,
					'circle-opacity': 0.9,
				}}
			/>
		</GeoJSONSource>
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
