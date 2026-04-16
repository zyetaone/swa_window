<script lang="ts">
	import { untrack } from 'svelte';
	import {
		MapLibre,
		GlobeControl,
		Sky,
		Light,
		CircleLayer,
		FillExtrusionLayer,
		FillLayer,
		GeoJSONSource,
		HeatmapLayer,
		HillshadeLayer,
		LineLayer,
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
		// Dawn (5-7) — fog is warm haze matching cloud underlight
		if (h >= 5 && h < 7)  return { sky: '#2a1f4a', horizon: '#e8805a', fog: '#d8b898', light: '#ffd4b8', intensity: 0.55, water: { r: 70, g: 50, b: 90 } };
		// Morning (7-10) — fog is cloud-white haze blending with cloud deck
		if (h >= 7 && h < 10) return { sky: '#4a7ab5', horizon: '#a0c8e8', fog: '#c8d8e8', light: '#fff1d6', intensity: 0.7,  water: { r: 50, g: 92, b: 130 } };
		// Day (10-16) — fog pushed toward hazy blue-white so clouds merge with horizon
		if (h >= 10 && h < 16) return { sky: '#001e3d', horizon: '#4a7ab0', fog: '#8aa8c8', light: '#fffef2', intensity: 0.8,  water: { r: 32, g: 74, b: 96 } };
		// Afternoon→Dusk (16-18)
		if (h >= 16 && h < 18) return { sky: '#2c3e75', horizon: '#d4895a', fog: '#c68860', light: '#ffc080', intensity: 0.65, water: { r: 100, g: 90, b: 90 } };
		// Dusk / golden hour (18-20)
		if (h >= 18 && h < 20) return { sky: '#1e1a40', horizon: '#c05f40', fog: '#8a4a40', light: '#ff9050', intensity: 0.5,  water: { r: 130, g: 75, b: 50 } };
		// Twilight (20-22)
		if (h >= 20 && h < 22) return { sky: '#0a0f28', horizon: '#301838', fog: '#1a1432', light: '#7a88d0', intensity: 0.28, water: { r: 10, g: 18, b: 35 } };
		// Night (22-5)
		return { sky: '#050510', horizon: '#0a1028', fog: '#0a0f20', light: '#a8b4d0', intensity: 0.2, water: { r: 4, g: 14, b: 24 } };
	});

	// ── Single RAF for water shimmer + city light flicker ────────────────────
	// One loop drives both animation clocks. City flicker setPaintProperty is
	// applied inline (consolidates the former second $effect + RAF).
	let waterTime = $state(0);
	$effect(() => {
		let raf: number;
		let last = performance.now();
		const loop = (now: number) => {
			untrack(() => {
				const dt = Math.min((now - last) / 1000, 0.1);
				last = now;
				waterTime += dt;

				// City-light flicker — apply directly to map layer each frame.
				// Multi-frequency sine: fast micro-flicker (~82 Hz), medium (~14.5 Hz),
				// slow swell (~2.5 Hz) layered for organic urban-light feel.
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

	const waterColor = $derived.by(() => {
		const shimmer = Math.sin(waterTime * 0.6) * 0.5 + 0.5; // 0..1
		const w = skyPalette.water;
		const r = Math.round(w.r + shimmer * 10);
		const g = Math.round(w.g + shimmer * 10);
		const b = Math.round(w.b + shimmer * 12);
		return `rgba(${r}, ${g}, ${b}, 1)`;
	});
	const waterOpacity = $derived(0.35 + Math.sin(waterTime * 0.4) * 0.06);

	function hexToRgba(hex: string, alpha: number) {
		const r = parseInt(hex.slice(1, 3), 16) || 255;
		const g = parseInt(hex.slice(3, 5), 16) || 255;
		const b = parseInt(hex.slice(5, 7), 16) || 255;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	// ── Procedural Volumetric Fog Points (GeoJSON) ───────────────────────────
	const fogGeoJSON = $derived.by(() => {
		const features = [];
		const blLat = lat;
		const blLon = lon;
		// 200 soft fog blobs scattered far across the city/terrain
		for (let i = 0; i < 200; i++) {
			features.push({
				type: 'Feature' as const,
				geometry: {
					type: 'Point' as const,
					coordinates: [
						blLon + (Math.random() - 0.5) * 0.8,
						blLat + (Math.random() - 0.5) * 0.8
					]
				},
				properties: { weight: Math.random() * 0.5 + 0.5 }
			});
		}
		return { type: 'FeatureCollection' as const, features };
	});

	// ── Procedural Cloud Shadows (GeoJSON Points) ────────────────────────────
	// Large, soft, dark circles drifting over the terrain at a throttled rate
	// to prevent MapLibre setData() overhead.
	let shadowTime = $state(0);
	$effect(() => {
		const interval = setInterval(() => {
			shadowTime += 0.1; // Updates at 10Hz, drifting east
		}, 100);
		return () => clearInterval(interval);
	});

	const shadowGeoJSON = $derived.by(() => {
		const features = [];
		// Seed 25 massive shadow blobs
		for (let i = 0; i < 25; i++) {
			const rawX = (i * 0.741) % 1;
			const rawY = (i * 0.312) % 1;
			// Drift logic: shadows wrap horizontally across a ~2-degree local bounding area
			const sx = (rawX + shadowTime * 0.05) % 1;
			const pLon = lon + (sx - 0.5) * 2.0;
			const pLat = lat + (rawY - 0.5) * 2.0;
			
			features.push({
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [pLon, pLat] },
				properties: {},
			});
		}
		return { type: 'FeatureCollection' as const, features };
	});

	// ── Procedural HUD Grid (GeoJSON Lines) ──────────────────────────────────
	// A glowing neon topographical grid layered tightly over the terrain around
	// the active location. Gives a high-tech "flight envelope" aesthetic.
	// Only updates when locationId changes to maintain perfect 60fps performance!
	const localGridGeoJSON = $derived.by(() => {
		void locationId; // reactivity anchor — grid re-centers when location changes
		const features = [];
		const step = 0.05; // ~5km gaps
		const span = 1.0;  // 1 degree radius
		
		// Snap to absolute grid space so the lines are geographically locked
		const centerLat = Math.round(lat);
		const centerLon = Math.round(lon);
		
		// Latitude lines
		for (let y = centerLat - span; y <= centerLat + span; y += step) {
			features.push({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[centerLon - span, y], [centerLon + span, y]] }, properties: {} });
		}
		// Longitude lines
		for (let x = centerLon - span; x <= centerLon + span; x += step) {
			features.push({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[x, centerLat - span], [x, centerLat + span]] }, properties: {} });
		}
		return { type: 'FeatureCollection' as const, features };
	});

	// Shore shimmer — coastline outline pulses between bright foam and deep water.
	// fill-outline-color is a 1px anti-aliased line around each water polygon.
	const shoreColor = $derived.by(() => {
		const wave = Math.sin(waterTime * 1.2) * 0.5 + 0.5; // 0..1 at ~0.2 Hz
		if (nightFactor > 0.5) {
			// Night: moonlit silver-blue shimmer
			const b = Math.round(80 + wave * 40);
			return `rgba(${60 + Math.round(wave * 20)}, ${70 + Math.round(wave * 25)}, ${b}, 0.7)`;
		}
		// Day: bright foam white → turquoise pulse
		const r = Math.round(180 + wave * 75);
		const g = Math.round(210 + wave * 45);
		const b = Math.round(220 + wave * 35);
		return `rgba(${r}, ${g}, ${b}, 0.6)`;
	});

	// Night water reflection — warm amber glow on water bodies near cities
	const nightWaterColor = $derived.by(() => {
		const pulse = Math.sin(waterTime * 0.3) * 0.5 + 0.5;
		const a = Math.round(40 + pulse * 20);
		return `rgba(255, 200, 120, ${(a / 255).toFixed(3)})`;
	});
	const nightWaterOpacity = $derived(nightFactor * 0.25 + Math.sin(waterTime * 0.5) * 0.04);

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
		if (import.meta.env.DEV) (window as any).__map = mapRef;

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

	// City-light flicker is now handled inline in the single RAF loop above.

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

		<!-- HOLOGRAPHIC TOPO-GRID — Draped globally over terrain. Fades out aggressively
		     as camera nears the ground (zoom > 10). Awesome high-speed flight aesthetic. -->
		<GeoJSONSource id="topo-grid" data={localGridGeoJSON}>
			<LineLayer
				id="topo-grid-layer"
				source="topo-grid"
				paint={{
					'line-color': '#7faeff',
					'line-width': 1.5,
					'line-blur': 1,
					'line-opacity': [
						'interpolate', ['linear'], ['zoom'],
						6, 0.4,
						10, 0.1,
						12, 0.0
					]
				}}
			/>
		</GeoJSONSource>

		<!-- Sky — fog-color set to a cloud-matching haze so the map's own horizon
		     blends seamlessly into the CSS cloud overlay above. The fog-ground-blend
		     pushed higher (0.65) spreads the haze further from the ground, creating
		     the effect of clouds fading INTO the terrain at the horizon line.
		     sky-horizon-blend widened for a softer sky→horizon transition.
		     Per the sky-fog-terrain MapLibre example — all 3 blends work together. -->
		<Sky
			sky-color={skyPalette.sky}
			horizon-color={skyPalette.horizon}
			fog-color={skyPalette.fog}
			sky-horizon-blend={0.85}
			horizon-fog-blend={0.95}
			fog-ground-blend={0.65}
			atmosphere-blend={['interpolate', ['linear'], ['zoom'], 0, 1.0, 8, 0.85, 14, 0.5]}
		/>

		<!-- VOLUMETRIC GROUND FOG — Heatmap over low-elevation areas.
		     Driven by Svelte GeoJSON point generation. Color tracks sky palette. -->
		<GeoJSONSource id="ground-fog" data={fogGeoJSON}>
			<HeatmapLayer
				id="ground-fog-layer"
				source="ground-fog"
				paint={{
					'heatmap-weight': ['get', 'weight'],
					'heatmap-intensity': 1.0,
					'heatmap-color': [
						'interpolate', ['linear'], ['heatmap-density'],
						0, 'rgba(255, 255, 255, 0)',
						0.4, hexToRgba(skyPalette.fog, 0.2),
						0.8, hexToRgba(skyPalette.fog, 0.6),
						1, hexToRgba(skyPalette.fog, 0.85)
					],
					'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 6, 20, 10, 80, 14, 250],
					'heatmap-opacity': 0.7,
				}}
			/>
		</GeoJSONSource>
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
					// Night: near-black shadows, near-black highlights — terrain
					// recedes into darkness, letting VIIRS glow dominate.
					// Day: warm amber shadows + cream highlights for sunlit relief.
					'hillshade-shadow-color': nightFactor > 0.5 ? '#050810' : '#473B24',
					'hillshade-highlight-color': nightFactor > 0.5 ? '#0a0f20' : '#ffe8c0',
					'hillshade-accent-color': nightFactor > 0.5 ? '#08101a' : '#8a6040',
					'hillshade-exaggeration': 0.5,
				}}
			/>
		</RasterDEMTileSource>
	{/if}

	<!-- CLOUD SHADOWS — Drifting dark spots over terrain driven by GeoJSON.
	     Rendered before vector roads/buildings so it acts like a ground shadow. -->
	{#if showAtmosphere}
		<GeoJSONSource id="cloud-shadows" data={shadowGeoJSON}>
			<CircleLayer
				id="cloud-shadows-layer"
				source="cloud-shadows"
				paint={{
					'circle-color': '#030814',
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 60, 10, 200, 14, 500],
					'circle-blur': 2.5,
					'circle-opacity': 0.15,
				}}
			/>
		</GeoJSONSource>
	{/if}

	<!-- OpenFreeMap vector tiles — free, global, no API key. Always mounted so
	     water renders regardless of building toggle. Provides OpenMapTiles-schema
	     vector source with 'building' + 'water' + 'transportation' + 'place'. -->
	<VectorTileSource
		id="openmaptiles"
		url="https://tiles.openfreemap.org/planet"
		minzoom={0}
		maxzoom={14}
	>
		<!-- WATER — ocean/lake/river fill with animated shimmer color +
		     pulsing shore outline for coastline wave effect. Always visible
		     from z3+ (was previously gated behind showBuildings). -->
		<FillLayer
			id="water-shimmer"
			source="openmaptiles"
			sourceLayer="water"
			minzoom={3}
			paint={{
				'fill-color': waterColor,
				'fill-opacity': waterOpacity,
				'fill-outline-color': shoreColor,
				'fill-antialias': true,
			}}
		/>

		<!-- HDR COASTAL BLOOM — Blurred glowing stroke along coastlines 
		     peaking in intensity at dawn/dusk to simulate light bloom. -->
		<LineLayer
			id="water-bloom"
			source="openmaptiles"
			sourceLayer="water"
			minzoom={3}
			paint={{
				'line-color': 'rgba(255, 255, 255, 0.4)',
				'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 10, 4, 14, 12],
				'line-blur': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 3, 14, 10],
				'line-opacity': Math.max(0, 1 - Math.abs(nightFactor - 0.5) * 2.5), // peaks at dawn/dusk (nf=0.5)
			}}
		/>

		<!-- WATER NIGHT GLOW — warm amber reflection on water bodies at night.
		     Simulates city light reflecting off ocean/harbor surfaces. -->
		{#if nightFactor > 0.15}
			<FillLayer
				id="water-night-glow"
				source="openmaptiles"
				sourceLayer="water"
				minzoom={6}
				paint={{
					'fill-color': nightWaterColor,
					'fill-opacity': nightWaterOpacity,
				}}
			/>
		{/if}

		<!-- ROADS — warm amber glow at night. Per-class sizing: highways
		     brightest + widest, side streets dim. -->
		{#if nightFactor > 0.1}
			<LineLayer
				id="road-glow"
				source="openmaptiles"
				sourceLayer="transportation"
				minzoom={6}
				filter={['!=', ['get', 'brunnel'], 'tunnel']}
				paint={{
					'line-color': [
						'match', ['get', 'class'],
						'motorway', `rgba(255, 200, 120, ${0.8 * nightFactor})`,
						'trunk',    `rgba(255, 180, 100, ${0.7 * nightFactor})`,
						'primary',  `rgba(255, 170, 90,  ${0.6 * nightFactor})`,
						'secondary',`rgba(230, 155, 80,  ${0.5 * nightFactor})`,
						'tertiary', `rgba(200, 140, 70,  ${0.4 * nightFactor})`,
						/* default */ `rgba(160, 110, 60,  ${0.25 * nightFactor})`,
					],
					'line-width': [
						'interpolate', ['linear'], ['zoom'],
						6,  ['match', ['get', 'class'], 'motorway', 1.2, 'trunk', 0.9, 'primary', 0.6, 0.3],
						10, ['match', ['get', 'class'], 'motorway', 2.5, 'trunk', 2,   'primary', 1.4, 0.8],
						14, ['match', ['get', 'class'], 'motorway', 5,   'trunk', 4,   'primary', 3,   1.8],
					],
					'line-blur': 0.6,
					'line-opacity': 0.85,
				}}
			/>

			<!-- TRAFFIC LIGHT TRAILS — Inner core laser line on top of arterial glow. -->
			<LineLayer
				id="road-traffic-core"
				source="openmaptiles"
				sourceLayer="transportation"
				minzoom={8}
				filter={['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]]]}
				paint={{
					'line-color': '#ffffff',
					'line-width': [
						'interpolate', ['linear'], ['zoom'],
						8, 0.4,
						14, 2.0
					],
					'line-blur': 0.3,
					'line-opacity': 0.7 * nightFactor,
				}}
			/>
		{/if}

		<!-- BUILDINGS — 3D extrusions, gated by toggle. Warm amber at night
		     with height-based brightness (taller = more lit windows). -->
		{#if showBuildings}
			<FillExtrusionLayer
				source="openmaptiles"
				sourceLayer="building"
				minzoom={13}
				filter={['!=', ['get', 'hide_3d'], true]}
				paint={{
					'fill-extrusion-color': nightFactor > 0.5
						? [
							'interpolate', ['linear'], ['get', 'render_height'],
							0,   `rgba(25, 22, 18, 0.95)`,
							30,  `rgba(90, 65, 40, 1.0)`,
							80,  `rgba(180, 130, 70, 1.0)`,
							150, `rgba(230, 170, 90, 1.0)`,
							250, `rgba(255, 195, 110, 1.0)`,
							400, `rgba(255, 220, 140, 1.0)`,
						]
						: [
							'interpolate', ['linear'], ['get', 'render_height'],
							0, `rgba(${Math.round(180 * nightBrightness)}, ${Math.round(175 * nightBrightness)}, ${Math.round(165 * nightBrightness)}, 0.85)`,
							200, `rgba(${Math.round(210 * nightBrightness)}, ${Math.round(205 * nightBrightness)}, ${Math.round(195 * nightBrightness)}, 0.95)`,
							400, `rgba(${Math.round(225 * nightBrightness)}, ${Math.round(220 * nightBrightness)}, ${Math.round(210 * nightBrightness)}, 1.0)`,
						],
					'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, ['get', 'render_height']],
					'fill-extrusion-base': ['step', ['zoom'], 0, 14, ['get', 'render_min_height']],
					'fill-extrusion-opacity': nightFactor > 0.5 ? 1.0 : 0.85,
					'fill-extrusion-vertical-gradient': nightFactor < 0.5,
				}}
			/>
		{/if}

		<!-- CITY GLOW — procedural warm discs on OpenMapTiles 'place' points.
		     Rank-scaled: world-class cities get largest glow. Opacity driven by
		     nightFactor + flicker (applied via setPaintProperty in the RAF loop). -->
		{#if showCityLights && nightFactor > 0.15}
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
						4, ['case', ['<=', ['get', 'rank'], 3], 2, ['<=', ['get', 'rank'], 6], 1, 0.5],
						10, ['case', ['<=', ['get', 'rank'], 3], 5, ['<=', ['get', 'rank'], 6], 3, 1.5],
						14, ['case', ['<=', ['get', 'rank'], 3], 8, ['<=', ['get', 'rank'], 6], 5, 3],
					],
					'circle-blur': 1.8,
					'circle-opacity': nightFactor * 0.6,
				}}
			/>
		{/if}
	</VectorTileSource>

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
					'raster-opacity': nightFactor * 0.92,
					'raster-fade-duration': 300,
					// Warmer amber tint — boost the gold that's naturally in VIIRS data
					'raster-hue-rotate': 15,
					'raster-saturation': 0.4,
					'raster-brightness-max': 1.5 + nightFactor * 0.4,
					'raster-contrast': 0.35,
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

	<!-- City-glow CircleLayer is now inside the VectorTileSource block above. -->

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
						5,  ['match', ['get', 'rank'], 1, 3,  2, 2,  3, 1, 1],
						10, ['match', ['get', 'rank'], 1, 10, 2, 7,  3, 4, 4],
						14, ['match', ['get', 'rank'], 1, 20, 2, 14, 3, 8, 8],
					],
					'circle-blur': 2.0,
					// Halo appears at dusk, strong at night, invisible during day
					'circle-opacity': Math.max(0, (nightFactor - 0.15) * 0.9),
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
						5,  ['match', ['get', 'rank'], 1, 1.5, 2, 1,   3, 0.5, 0.5],
						10, ['match', ['get', 'rank'], 1, 4,   2, 3,   3, 2, 2],
						14, ['match', ['get', 'rank'], 1, 7,   2, 5,   3, 3, 3],
					],
					'circle-blur': 0.6,
					// Hide landmark cores during day — they read as 'stuck moons'
					// in bright sunlight. Fade in at dusk, full at night.
					'circle-opacity': Math.max(0, (nightFactor - 0.2) * 1.25),
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
