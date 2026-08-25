<script lang="ts">
	/**
	 * Ground — satellite colour: a global base layer plus an optional
	 * higher-resolution detail layer where coverage exists.
	 */
	import { RasterLayer, RasterTileSource } from 'svelte-maplibre-gl';

	import {
		IMAGERY_GRADE,
		TILE_ATTRIBUTION,
		TILE_MAXZOOM,
		TILE_SIZE,
		tileTemplates
	} from '#lib/settings/tiles.js';
	import { useDisplay } from '../display.svelte.js';

	const display = useDisplay();
	const tiles = tileTemplates();
</script>

<RasterTileSource
	id="gibs"
	tiles={tiles.gibs}
	tileSize={TILE_SIZE}
	maxzoom={TILE_MAXZOOM.gibs}
	attribution={TILE_ATTRIBUTION}
>
	<RasterLayer
		paint={{
			'raster-opacity': 1,
			'raster-saturation': IMAGERY_GRADE.saturation,
			'raster-contrast': IMAGERY_GRADE.contrast,
			'raster-fade-duration': IMAGERY_GRADE.fadeDuration,
			'raster-resampling': IMAGERY_GRADE.resampling
		}}
	/>
</RasterTileSource>

<!-- MOUNTED CONDITIONALLY, and that is load-bearing. `raster-opacity: 0` hides
     a layer but does NOT stop it fetching: over Hyderabad, where NAIP has no
     coverage, an invisible layer streamed 404s at the tile server by the
     hundred. A layer that renders nothing must not exist. Has regressed 3x. -->
{#if display.config.detail > 0}
	<RasterTileSource id="usgs" tiles={tiles.usgs} tileSize={TILE_SIZE} maxzoom={TILE_MAXZOOM.usgs}>
		<RasterLayer paint={{ 'raster-opacity': display.config.detail }} />
	</RasterTileSource>
{/if}
