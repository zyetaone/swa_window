<script lang="ts">
	/**
	 * MapLibreCell — one map instance per grid tile.
	 *
	 * Commit 2: puts a REAL MapLibre globe in each of the six cells.
	 * Globe projection, bird's-eye pitch, Sentinel-2 satellite imagery
	 * (EOX, free CC-BY). No user-interaction — this is a view, not a
	 * map control. State flows from sceneState via SSOT.
	 *
	 * Each cell has its own map instance. That's expensive (six WebGL
	 * contexts) but clear. If FPS tanks in Chrome we can flip to a
	 * shared canvas later; for now we prioritise correctness over
	 * throughput while iterating the layer stack.
	 */
	import { onMount } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { sceneState } from './lib/scene-state.svelte';
	import { altitudeToZoom, latZoomAdjust } from './lib/globe-zoom';
	import { addBuildings, removeBuildings } from './layers/buildings';
	import LandscapeAbstractionLayer from './layers/LandscapeAbstractionLayer.svelte';
	import SceneHost from './three-map/SceneHost.svelte';

	interface Props {
		/** When true, load OSM building extrusions for the active location. */
		showBuildings?: boolean;
		/** When true, render Three.js water mesh via the MapScene CustomLayer
		 *  (the artwork-abstraction path — replaces chroma-key). */
		showWaterMesh?: boolean;
		/** The MapLibre canvas — exposed for overlay layers (WaterOverlay reads this). */
		mapCanvas?: HTMLCanvasElement;
	}

	let {
		showBuildings = false,
		showWaterMesh = false,
		mapCanvas = $bindable(),
	}: Props = $props();

	let container = $state<HTMLDivElement | undefined>();
	let map = $state<maplibregl.Map | null>(null);
	let ready = $state(false);

	// Simple night-factor — dark between 18.5–5.5h, full day 7–17h, smooth transitions.
	const nightFactor = $derived.by(() => {
		const t = sceneState.timeOfDay;
		if (t >= 18.5 || t <= 5.5) return 1.0;
		if (t >= 7 && t <= 17) return 0.0;
		if (t < 7) return (7 - t) / 1.5;
		return (t - 17) / 1.5;
	});

	// Track last applied latitude so camera changes can compensate for
	// globe auto-enlargement. Without this, sliding "altitude" while
	// the camera is at a different latitude gives a surprising zoom.
	let lastLat = sceneState.lat;

	onMount(() => {
		if (!container) return;

		map = new maplibregl.Map({
			container,
			style: {
				version: 8,
				sources: {
					satellite: {
						type: 'raster',
						tiles: [
							'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
						],
						tileSize: 256,
						maxzoom: 14,
						attribution:
							'Sentinel-2 cloudless — © EOX IT Services GmbH (CC BY-NC-SA 4.0)',
					},
				},
				layers: [
					{
						id: 'bg',
						type: 'background',
						paint: { 'background-color': '#04060d' },
					},
					{
						id: 'sat',
						type: 'raster',
						source: 'satellite',
						paint: { 'raster-fade-duration': 350 },
					},
				],
			},
			center: [sceneState.lon, sceneState.lat],
			zoom: altitudeToZoom(sceneState.altitudeMeters),
			pitch: 60, // bird's-eye forward-look
			bearing: sceneState.headingDeg,
			attributionControl: false,
			interactive: false, // view-only; sceneState drives camera
		});

		map.on('style.load', () => {
			map!.setProjection({ type: 'globe' });
			ready = true;
			// Expose the rendering canvas upward so overlay layers (Water,
			// future post-process) can read from it.
			mapCanvas = map!.getCanvas();
		});

		return () => {
			map?.remove();
			map = null;
		};
	});

	// React to SSOT changes — smooth camera updates across all cells
	// in lockstep. Latitude compensation keeps apparent zoom consistent
	// when the user flies between latitudes.
	$effect(() => {
		if (!map || !ready) return;
		const targetLat = sceneState.lat;
		const targetLon = sceneState.lon;
		const baseZoom = altitudeToZoom(sceneState.altitudeMeters);
		const compensated = baseZoom + latZoomAdjust(lastLat, targetLat);
		map.easeTo({
			center: [targetLon, targetLat],
			zoom: compensated,
			bearing: sceneState.headingDeg,
			duration: 250,
		});
		lastLat = targetLat;
	});

	// Buildings layer: add / remove based on the showBuildings toggle.
	// Re-applies on nightFactor changes so the photometric tint updates.
	$effect(() => {
		if (!map || !ready) return;
		// `dubai` is the starting city — later cities will need their own
		// pre-baked GeoJSON under /api/buildings/:city. Missing files
		// resolve to empty (harmless).
		const city = 'dubai';
		if (showBuildings) {
			addBuildings(map, city, nightFactor);
		} else {
			removeBuildings(map);
		}
	});
</script>

<div class="map-root" bind:this={container}></div>

{#if map && ready}
	<LandscapeAbstractionLayer {map} />
	{#if showWaterMesh}
		<SceneHost {map} showWater={true} />
	{/if}
{/if}

<style>
	.map-root {
		width: 100%;
		height: 100%;
		background: #04060d;
	}

	/* Hide MapLibre's various overlays in the grid cells — we want a
	   clean view, not a dev tool look. */
	:global(.map-root .maplibregl-ctrl-attrib) {
		display: none !important;
	}
</style>
