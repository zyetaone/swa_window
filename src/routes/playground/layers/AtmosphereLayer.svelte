<script lang="ts">
	import {
		CircleLayer,
		GeoJSONSource,
		GlobeControl,
		Light,
		LineLayer,
		Sky,
	} from 'svelte-maplibre-gl';
	import type maplibregl from 'maplibre-gl';
	import CloudCanvasLayer from './CloudCanvasLayer.svelte';
	import VectorCloudLayer from './VectorCloudLayer.svelte';

	let {
		showAtmosphere,
		sunParams,
		skyPalette,
		fogGeoJSON,
		shadowGeoJSON,
		localGridGeoJSON,
		hexToRgba,
		/** Cloud canvas props — AtmosphereLayer is SSOT for distant clouds */
		mapRef,
		lat = 25.2,
		lon = 55.3,
		nightFactor = 0,
		cloudDensity = 0.75,
		heading = 0,
		weather = 'clear',
	}: {
		showAtmosphere: boolean;
		sunParams: { polar: number; azimuth: number; elevation: number };
		skyPalette: { sky: string; horizon: string; fog: string; light: string; intensity: number; water: { r: number; g: number; b: number } };
		fogGeoJSON: GeoJSON.FeatureCollection;
		shadowGeoJSON: GeoJSON.FeatureCollection;
		localGridGeoJSON: GeoJSON.FeatureCollection;
		hexToRgba: (hex: string, alpha: number) => string;
		mapRef?: maplibregl.Map;
		lat?: number;
		lon?: number;
		nightFactor?: number;
		cloudDensity?: number;
		heading?: number;
		weather?: 'clear' | 'cloudy' | 'rain' | 'overcast' | 'storm';
	} = $props();
</script>

{#if showAtmosphere}
	<GlobeControl />
	<!-- Ambient light: position follows sun, color + intensity match the hour. -->
	<Light
		anchor="map"
		position={[1.15, sunParams.azimuth, sunParams.polar]}
		color={skyPalette.light}
		intensity={skyPalette.intensity}
	/>

	<!-- HOLOGRAPHIC TOPO-GRID — Fades out as camera nears ground. -->
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

	<!-- Sky — fog creates the cloud-white haze band AT the horizon.
	     This is the primary mechanism for horizon clouds — MapLibre's native
	     atmosphere rendering. fog-color is cloud-white (from palette), and
	     fog-ground-blend at 0.85 pushes the haze high from the ground so it
	     fills the space between terrain and sky at the horizon line. -->
	<Sky
		sky-color={skyPalette.sky}
		horizon-color={skyPalette.horizon}
		fog-color={skyPalette.fog}
		sky-horizon-blend={0.98}
		horizon-fog-blend={1.0}
		fog-ground-blend={0.85}
		atmosphere-blend={['interpolate', ['linear'], ['zoom'], 0, 1.0, 5, 1.0, 8, 0.95, 14, 0.7]}
	/>

	<!-- VOLUMETRIC GROUND FOG — Heatmap driven by GeoJSON points. -->
	<!-- Ground fog — blurred circles instead of HeatmapLayer (which triggers
	     calculateFogMatrix warnings on globe projection). Same visual effect. -->
	<GeoJSONSource id="ground-fog" data={fogGeoJSON}>
		<CircleLayer
			id="ground-fog-layer"
			source="ground-fog"
			paint={{
				'circle-color': hexToRgba(skyPalette.fog, 0.5),
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 25, 10, 100, 14, 300],
				'circle-blur': 2.0,
				'circle-opacity': ['*', ['get', 'weight'], 0.45],
			}}
		/>
	</GeoJSONSource>

	<!-- CLOUD SHADOWS — Drifting dark spots over terrain. -->
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

	<!-- DISTANT CLOUD LAYER — Canvas source projected onto globe.
	     SSOT for horizon/distant clouds. Proper depth sorting with terrain.
	     CSS3DClouds handles foreground sprites as CSS overlay. -->
	<CloudCanvasLayer
		{mapRef}
		{lat}
		{lon}
		{nightFactor}
		density={cloudDensity}
		{heading}
		{weather}
	/>

	<!-- VECTOR CLOUDS — GeoJSON-driven cloud sprites rendered natively by MapLibre.
	     Proper perspective, depth sorting, horizon recession — all automatic.
	     This is the SSOT for distant/mid-field clouds. -->
	<VectorCloudLayer
		{lat}
		{lon}
		density={cloudDensity}
		{heading}
		{nightFactor}
		{weather}
	/>
{/if}
