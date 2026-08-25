<script lang="ts">
	/**
	 * Ground — satellite colour: a global base layer plus an optional
	 * higher-resolution detail layer where coverage exists.
	 *
	 * Circadian-aware: brightness adjusts smoothly from daytime solar illumination
	 * to atmospheric twilight and night.
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

	const night = $derived(display.night);

	/**
	 * Pull the white out of the texture.
	 *
	 * MODIS at z9 is a hazy, low-contrast wash — the bright end blows out into a
	 * flat sheet long before the dark end does anything, which is what reads as
	 * "white" from the window. Capping the bright end below 1 is what actually
	 * removes it; contrast alone just moves the blowout around.
	 */
	const DAY_HIGHLIGHT_CEIL = 0.86;

	/**
	 * At night, let the light seep through.
	 *
	 * The trick is that the floor falls FASTER than the ceiling. Everything dim
	 * — fields, water, bare ground — is crushed to black, while the brightest
	 * pixels, which over a city are the built-up areas, survive the squeeze and
	 * are all that is left glowing. Uniformly dimming the layer instead just
	 * produces a grey daytime picture at midnight.
	 *
	 * This is a poor cousin of a real night-lights raster (v1 composited VIIRS
	 * for exactly this), but it costs no extra source and no extra fetch.
	 */
	const groundBrightnessMax = $derived(DAY_HIGHLIGHT_CEIL - night * 0.42);
	const groundBrightnessMin = $derived(0.04 * (1 - night) ** 2);

	/** Lift contrast into the night so the surviving highlights separate. */
	const groundContrast = $derived(IMAGERY_GRADE.contrast + night * 0.34);

	/**
	 * Desaturate INTO the night rather than out of it. Night imagery is still a
	 * daylight photograph; leaving it colour-saturated at low brightness reads
	 * as murky brown rather than as darkness.
	 */
	const groundSaturation = $derived(IMAGERY_GRADE.saturation - night * 0.3);
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
			'raster-saturation': groundSaturation,
			'raster-contrast': groundContrast,
			'raster-brightness-max': groundBrightnessMax,
			'raster-brightness-min': groundBrightnessMin,
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
