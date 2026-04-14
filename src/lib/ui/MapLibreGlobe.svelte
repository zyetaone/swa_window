<script lang="ts">
	import {
		MapLibre,
		GlobeControl,
		Sky,
		Light,
		FillExtrusionLayer,
		RasterDEMTileSource,
		Terrain,
		Projection,
	} from 'svelte-maplibre-gl';
	import { PMTilesProtocol } from '@svelte-maplibre-gl/pmtiles';
	import type maplibregl from 'maplibre-gl';

	let {
		lat = 25.2,
		lon = 55.3,
		zoom = 10,
		pitch = -45,
		bearing = 0,
		pmtilesUrl = '',
		terrainPmtilesUrl = '',
		showBuildings = false,
		showTerrain = false,
		showAtmosphere = true,
		nightFactor = 0,
	}: {
		lat?: number;
		lon?: number;
		zoom?: number;
		pitch?: number;
		bearing?: number;
		pmtilesUrl?: string;
		terrainPmtilesUrl?: string;
		showBuildings?: boolean;
		showTerrain?: boolean;
		showAtmosphere?: boolean;
		nightFactor?: number;
	} = $props();

	const VOYAGER_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

	let mapRef = $state<maplibregl.Map | undefined>(undefined);

	let styleUrl = $derived(pmtilesUrl || VOYAGER_STYLE);

	let nightBrightness = $derived(Math.max(0.2, 1 - nightFactor * 1.3));

	export function flyTo(dst: { lat: number; lon: number; altitude?: number }, _duration = 2000) {
		if (!mapRef) return;
		mapRef.flyTo({
			center: [dst.lon, dst.lat],
			zoom: dst.altitude ? Math.max(8, 16 - Math.log2(dst.altitude / 30000)) : zoom,
			duration: _duration,
		});
	}
</script>

<MapLibre
	bind:map={mapRef}
	class="map-container"
	center={{ lng: lon, lat }}
	{zoom}
	{pitch}
	{bearing}
	style={styleUrl}
	attributionControl={false}
	maxPitch={85}
	autoloadGlobalCss={false}
>
	<Projection type="globe" />

	{#if showAtmosphere}
		<GlobeControl />
		<Light anchor="map" position={[1.5, 90, 80]} />
		<Sky
			sky-color="#001e3d"
			horizon-color="#1a4a7a"
			fog-color="#1a3a5c"
			sky-horizon-blend={0.3}
			horizon-fog-blend={0.5}
			atmosphere-blend={0.4}
		/>
	{/if}

	{#if terrainPmtilesUrl && showTerrain}
		<PMTilesProtocol scheme="pmtiles" pmtiles={[]} />
		<RasterDEMTileSource id="terrain" url={`pmtiles://${terrainPmtilesUrl}`}>
			<Terrain exaggeration={1.5} />
		</RasterDEMTileSource>
	{/if}

	{#if showBuildings}
		<FillExtrusionLayer
			source="carto"
			sourceLayer="building"
			minzoom={13}
			filter={['!=', ['get', 'hide_3d'], true]}
			paint={{
				'fill-extrusion-color': [
					'interpolate', ['linear'], ['get', 'render_height'],
					0, `rgba(${Math.round(180 * nightBrightness)}, ${Math.round(175 * nightBrightness)}, ${Math.round(165 * nightBrightness)}, 0.85)`,
					200, `rgba(${Math.round(210 * nightBrightness)}, ${Math.round(205 * nightBrightness)}, ${Math.round(195 * nightBrightness)}, 0.95)`,
					400, `rgba(${Math.round(225 * nightBrightness)}, ${Math.round(220 * nightBrightness)}, ${Math.round(210 * nightBrightness)}, 1.0)`,
				],
				'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, ['get', 'render_height']],
				'fill-extrusion-base': ['case', ['>=', ['get', 'zoom'], 14], ['get', 'render_min_height'], 0],
				'fill-extrusion-opacity': 0.85,
			}}
		/>
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
