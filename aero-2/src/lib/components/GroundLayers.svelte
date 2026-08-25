<script lang="ts">
	/**
	 * The ground: two colour layers, one DEM used twice.
	 *
	 * ponytail: two raster layers IS the detail system. No splat map, no PBR
	 * blending — MapLibre already fades between zoom levels and skips tiles it
	 * cannot fetch. Reach for a shader when this stops working.
	 */
	import {
		HillshadeLayer,
		RasterDEMTileSource,
		RasterLayer,
		RasterTileSource,
		Terrain
	} from 'svelte-maplibre-gl';

	import { HILLSHADE_SHADOW_COLOR, TERRAIN_EXAGGERATION } from '#lib/window/config.js';
	import {
		TILE_ATTRIBUTION,
		TILE_MAXZOOM,
		TILE_SIZE,
		tileTemplates
	} from '#lib/world/imagery/tiles.js';

	interface Props {
		/** Opacity of the US-only detail layer. 0 leaves the global base showing. */
		detail: number;
		/** Hillshade exaggeration. */
		shade: number;
	}

	const { detail, shade }: Props = $props();

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

<RasterTileSource id="usgs" tiles={tiles.usgs} tileSize={TILE_SIZE} maxzoom={TILE_MAXZOOM.usgs}>
	<RasterLayer paint={{ 'raster-opacity': detail }} />
</RasterTileSource>

<RasterDEMTileSource
	id="dem"
	tiles={tiles.terrarium}
	encoding="terrarium"
	tileSize={TILE_SIZE}
	maxzoom={TILE_MAXZOOM.terrarium}
>
	<Terrain exaggeration={TERRAIN_EXAGGERATION} />
	<!-- Declared after the imagery so it draws over it. Same source as the
	     terrain mesh — one fetch, two uses. -->
	<HillshadeLayer
		paint={{ 'hillshade-exaggeration': shade, 'hillshade-shadow-color': HILLSHADE_SHADOW_COLOR }}
	/>
</RasterDEMTileSource>
