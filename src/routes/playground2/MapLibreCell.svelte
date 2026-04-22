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

	let container = $state<HTMLDivElement | undefined>();
	let map: maplibregl.Map | null = null;
	let ready = $state(false);

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
</script>

<div class="map-root" bind:this={container}></div>

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
