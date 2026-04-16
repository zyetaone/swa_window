<script lang="ts">
	import {
		CircleLayer,
		GeoJSONSource,
		GlobeControl,
		Light,
		LineLayer,
		Sky,
	} from 'svelte-maplibre-gl';

	let {
		showAtmosphere,
		sunParams,
		skyPalette,
		fogGeoJSON,
		shadowGeoJSON,
		localGridGeoJSON,
		hexToRgba,
	}: {
		showAtmosphere: boolean;
		sunParams: { polar: number; azimuth: number; elevation: number };
		skyPalette: { sky: string; horizon: string; fog: string; light: string; intensity: number; water: { r: number; g: number; b: number } };
		fogGeoJSON: GeoJSON.FeatureCollection;
		shadowGeoJSON: GeoJSON.FeatureCollection;
		localGridGeoJSON: GeoJSON.FeatureCollection;
		hexToRgba: (hex: string, alpha: number) => string;
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

	<!-- Sky — fog-color blends horizon into CSS cloud overlay. -->
	<Sky
		sky-color={skyPalette.sky}
		horizon-color={skyPalette.horizon}
		fog-color={skyPalette.fog}
		sky-horizon-blend={0.95}
		horizon-fog-blend={1.0}
		fog-ground-blend={0.7}
		atmosphere-blend={['interpolate', ['linear'], ['zoom'], 0, 1.0, 8, 0.9, 14, 0.6]}
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
{/if}
