<script lang="ts">
	import { RasterLayer, RasterTileSource } from 'svelte-maplibre-gl';

	let {
		nightFactor,
	}: {
		nightFactor: number;
	} = $props();
</script>

<!-- VIIRS Black Marble — NASA's global earth-at-night composite.
     Rendered BELOW the CartoDB emission layer so bright city regions
     light up based on real data. -->
{#if nightFactor > 0.01}
	<RasterTileSource
		id="viirs-nightlights"
		tiles={['https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png']}
		tileSize={256}
		maxzoom={8}
	>
		<RasterLayer
			id="viirs-layer"
			source="viirs-nightlights"
			paint={{
				'raster-opacity': nightFactor * 0.92,
				'raster-fade-duration': 300,
				'raster-hue-rotate': 15,
				'raster-saturation': 0.4,
				'raster-brightness-max': 1.5 + nightFactor * 0.4,
				'raster-contrast': 0.35,
			}}
		/>
	</RasterTileSource>
{/if}

<!-- CartoDB dark_nolabels as emission overlay — streets/buildings glow warm. -->
{#if nightFactor > 0.01}
	<RasterTileSource
		id="night-overlay"
		tiles={['https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png']}
		tileSize={256}
		maxzoom={19}
	>
		<RasterLayer
			id="night-overlay-layer"
			source="night-overlay"
			paint={{
				'raster-opacity': nightFactor * 0.9,
				'raster-fade-duration': 300,
				'raster-contrast': 0.3 + (nightFactor * 0.4),
				'raster-brightness-min': 0,
				'raster-brightness-max': 1.0 + (nightFactor * 1.0),
				'raster-hue-rotate': nightFactor * 40,
				'raster-saturation': -0.2 + nightFactor * 0.5,
			}}
		/>
	</RasterTileSource>

	<!-- Labeled variant on TOP — labels become lit signs at night. -->
	<RasterTileSource
		id="night-labels"
		tiles={['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png']}
		tileSize={256}
		maxzoom={19}
	>
		<RasterLayer
			id="night-labels-layer"
			source="night-labels"
			paint={{
				'raster-opacity': nightFactor * 0.35,
				'raster-fade-duration': 300,
				'raster-brightness-min': 0.1,
				'raster-brightness-max': 1.8 + nightFactor * 0.6,
				'raster-hue-rotate': 30,
				'raster-saturation': 0.4,
				'raster-contrast': 0.35,
			}}
		/>
	</RasterTileSource>
{/if}
