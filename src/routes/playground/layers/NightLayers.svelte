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
     light up based on real data. Uses a steeper curve: barely visible at
     twilight (nf=0.5 → 25% opacity), fully dominant at full dark (nf=1).
     Production GLSL adds warm light on dark terrain — VIIRS approximates
     where that light should be. -->
{#if nightFactor > 0.2}
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
				// Steeper curve: nf=0.5 → 0.25, nf=0.8 → 0.64, nf=1.0 → 1.0
				'raster-opacity': Math.max(0, (nightFactor - 0.2) * (nightFactor > 0.5 ? 1.5 : 0.8)) * 0.9,
				'raster-fade-duration': 400,
				'raster-hue-rotate': 20,
				'raster-saturation': 0.5,
				'raster-brightness-max': nightFactor * 1.4 + 0.2,
				'raster-contrast': 0.3 + nightFactor * 0.3,
			}}
		/>
	</RasterTileSource>
{/if}

<!-- CartoDB dark_nolabels as emission overlay — streets/buildings glow warm.
     At full night: near-opaque dark overlay whose lit pixels punch through
     as warm amber city lights. Hue-rotate pushes the neutral basemap
     toward warm orange, reinforcing the production GLSL city palette. -->
{#if nightFactor > 0.1}
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
				'raster-opacity': nightFactor * 0.85,
				'raster-fade-duration': 400,
				'raster-contrast': 0.25 + nightFactor * 0.55,
				'raster-brightness-min': nightFactor > 0.5 ? 0.02 : 0.06,
				'raster-brightness-max': 0.9 + nightFactor * 0.8,
				// Warm shift: 45° at full night, simulates sodium vapor ambient
				'raster-hue-rotate': nightFactor * 45,
				'raster-saturation': -0.3 + nightFactor * 0.6,
			}}
		/>
	</RasterTileSource>

	<!-- Labeled variant on TOP — labels become lit signs at night.
	     Moderate opacity (max 0.35) so labels don't dominate the scene. -->
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
				'raster-opacity': nightFactor * 0.32,
				'raster-fade-duration': 400,
				'raster-brightness-min': 0.08,
				'raster-brightness-max': 1.6 + nightFactor * 0.5,
				'raster-hue-rotate': 25,
				'raster-saturation': 0.4,
				'raster-contrast': 0.3,
			}}
		/>
	</RasterTileSource>
{/if}
