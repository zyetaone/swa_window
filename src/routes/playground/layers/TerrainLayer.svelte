<script lang="ts">
	import { HillshadeLayer, RasterDEMTileSource, Terrain } from 'svelte-maplibre-gl';

	let {
		showTerrain,
		nightFactor,
		terrainExaggeration,
		terrainPmtilesUrl,
	}: {
		showTerrain: boolean;
		nightFactor: number;
		terrainExaggeration: number;
		terrainPmtilesUrl: string;
	} = $props();
</script>

{#if showTerrain}
	<!-- Mapterhorn terrain via tilejson (self-describing). -->
	<RasterDEMTileSource
		id="terrain"
		url={terrainPmtilesUrl ? `pmtiles://${terrainPmtilesUrl}` : 'https://tiles.mapterhorn.com/tilejson.json'}
	>
		<Terrain exaggeration={terrainExaggeration} />
	</RasterDEMTileSource>

	<!-- Hillshade — directional shadows on terrain. -->
	<RasterDEMTileSource
		id="hillshade"
		url="https://tiles.mapterhorn.com/tilejson.json"
	>
		<HillshadeLayer
			id="hillshade-layer"
			source="hillshade"
			paint={{
				'hillshade-shadow-color': nightFactor > 0.5 ? '#050810' : '#473B24',
				'hillshade-highlight-color': nightFactor > 0.5 ? '#0a0f20' : '#ffe8c0',
				'hillshade-accent-color': nightFactor > 0.5 ? '#08101a' : '#8a6040',
				'hillshade-exaggeration': 0.5,
			}}
		/>
	</RasterDEMTileSource>
{/if}
