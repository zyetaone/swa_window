<script lang="ts">
	/**
	 * NightLayers — CSS + raster compositing for night atmosphere.
	 *
	 * NOT a mask/bleed system. VIIRS data is conceptually noted but NOT rendered
	 * as a pixelated raster. Instead, city light placement + intensity is driven
	 * by CityLightsLayer (OpenFreeMap `place` points with rank-amplified glow)
	 * and by the CartoDB dark overlay whose lit pixels punch through as city glow.
	 *
	 * The raster layers here serve a compositing role only: CartoDB dark_nolabels
	 * provides the emission basemap at night (streets/labels glow warm via hue-
	 * rotate), and dark_all labels appear as lit signs at moderate opacity.
	 */

	import { RasterLayer, RasterTileSource } from 'svelte-maplibre-gl';

	let {
		nightFactor,
	}: {
		nightFactor: number;
	} = $props();
</script>

<!-- CartoDB dark_nolabels — the emission basemap at night.
     At full dark: near-opaque dark tile whose lit road/street pixels
     become the warm amber city glow. Hue-rotate shifts neutral dark
     toward sodium-orange to match the production GLSL city palette.
     Brightness-max capped so the overlay darkens rather than brightens. -->
{#if nightFactor > 0.15}
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
				// Post-process (three/shaders/night-grade.glsl) handles the
				// amber/bloom — this raster just needs to contribute dim
				// structure (darker terrain + lit-road hints). Hot input
				// pixels blow bloom out, so we clamp hard.
				'raster-opacity': nightFactor * 0.32,
				'raster-fade-duration': 400,
				'raster-contrast': 0.05 + nightFactor * 0.25,
				'raster-brightness-min': 0.02,
				'raster-brightness-max': 0.55,
				'raster-hue-rotate': nightFactor * 18,
				'raster-saturation': -0.4 + nightFactor * 0.4,
			}}
		/>
	</RasterTileSource>

	<!-- Labeled variant on TOP — road names + city labels glow at night.
	     Moderate opacity so labels act as signage, not a dominating layer. -->
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
				'raster-opacity': nightFactor * 0.18,
				'raster-fade-duration': 400,
				'raster-brightness-min': 0.06,
				'raster-brightness-max': Math.min(1.0, 0.6 + nightFactor * 0.4),
				'raster-hue-rotate': 22,
				'raster-saturation': 0.35,
				'raster-contrast': 0.28,
			}}
		/>
	</RasterTileSource>
{/if}
