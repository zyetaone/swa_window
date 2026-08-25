<script lang="ts">
	/**
	 * GroundLayers — NASA GIBS base imagery, USGS detail layer, and AWS DEM terrain & hillshade.
	 *
	 * The USGS source is mounted CONDITIONALLY, and that is load-bearing.
	 * `raster-opacity: 0` hides a layer but does NOT stop it fetching: over
	 * Hyderabad, where NAIP has no coverage, an invisible layer streamed
	 * hundreds of 404s per second at the tile server. A layer that renders
	 * nothing must not exist.
	 */
	import {
		HillshadeLayer,
		RasterDEMTileSource,
		RasterLayer,
		RasterTileSource,
		Terrain
	} from 'svelte-maplibre-gl';

	import { HILLSHADE_SHADOW_COLOR, TERRAIN_EXAGGERATION } from '#lib/sim/config.js';
	import { useAeroWindow } from '#lib/sim/context.js';
	import { TILE_ATTRIBUTION, TILE_MAXZOOM, TILE_SIZE, tileTemplates } from '#lib/stage/imagery.js';

	interface Props {
		/** Detail-layer opacity. 0 unmounts the source — see the note above. */
		detail?: number;
		shade?: number;
	}

	const { detail, shade }: Props = $props();
	const windowState = useAeroWindow();

	const effectiveDetail = $derived(detail ?? windowState.params.detail);
	const effectiveShade = $derived(shade ?? windowState.params.shade);

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

{#if effectiveDetail > 0}
	<RasterTileSource id="usgs" tiles={tiles.usgs} tileSize={TILE_SIZE} maxzoom={TILE_MAXZOOM.usgs}>
		<RasterLayer paint={{ 'raster-opacity': effectiveDetail }} />
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
			'hillshade-exaggeration': effectiveShade,
			'hillshade-shadow-color': HILLSHADE_SHADOW_COLOR,
			'hillshade-highlight-color': '#ffffff',
			'hillshade-illumination-anchor': 'map',
			'hillshade-illumination-direction': 315
		}}
	/>
</RasterDEMTileSource>
