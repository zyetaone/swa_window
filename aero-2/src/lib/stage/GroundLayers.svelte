<script lang="ts">
	/**
	 * GroundLayers — NASA GIBS base imagery, USGS detail layer, and AWS DEM terrain & hillshade.
	 */
	import {
		HillshadeLayer,
		RasterDEMTileSource,
		RasterLayer,
		RasterTileSource,
		Terrain
	} from 'svelte-maplibre-gl';

	import { HILLSHADE_SHADOW_COLOR, TERRAIN_EXAGGERATION } from '#lib/domain/pane.js';
	import { useAeroWindow } from '#lib/flight/aero-window.svelte.js';
	import { TILE_ATTRIBUTION, TILE_MAXZOOM, TILE_SIZE, tileTemplates } from '#lib/domain/imagery.js';

	const windowState = useAeroWindow();
	const tiles = tileTemplates();
</script>

<RasterTileSource
	id="gibs"
	tiles={tiles.gibs}
	tileSize={TILE_SIZE}
	maxzoom={TILE_MAXZOOM.gibs}
	attribution={TILE_ATTRIBUTION}
>
	<RasterLayer paint={{ 'raster-opacity': 1 }} />
</RasterTileSource>

<!-- MOUNTED CONDITIONALLY, and that is load-bearing. `raster-opacity: 0` hides
     a layer but does NOT stop it fetching: over Hyderabad, where NAIP has no
     coverage, an invisible layer streamed 404s at the tile server by the
     hundred. A layer that renders nothing must not exist. Has regressed 3x. -->
{#if windowState.params.detail > 0}
	<RasterTileSource id="usgs" tiles={tiles.usgs} tileSize={TILE_SIZE} maxzoom={TILE_MAXZOOM.usgs}>
		<RasterLayer paint={{ 'raster-opacity': windowState.params.detail }} />
	</RasterTileSource>
{/if}

<RasterDEMTileSource
	id="dem"
	tiles={tiles.terrarium}
	encoding="terrarium"
	tileSize={TILE_SIZE}
	maxzoom={TILE_MAXZOOM.terrarium}
>
	<Terrain exaggeration={TERRAIN_EXAGGERATION} />
	<HillshadeLayer
		paint={{
			'hillshade-exaggeration': windowState.params.shade,
			'hillshade-shadow-color': HILLSHADE_SHADOW_COLOR,
			'hillshade-highlight-color': '#ffffff',
			'hillshade-illumination-anchor': 'map',
			'hillshade-illumination-direction': 315
		}}
	/>
</RasterDEMTileSource>
