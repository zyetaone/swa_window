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
	const DAY_HIGHLIGHT_CEIL = 0.78;

	/**
	 * At night, let the light seep through while deeply darkening unlit terrain.
	 *
	 * The floor falls FASTER than the ceiling. Everything dim
	 * — fields, water, bare ground — is crushed to deep nocturnal tones, while the brightest
	 * pixels survive the squeeze and remain distinct.
	 */
	const groundBrightnessMax = $derived(DAY_HIGHLIGHT_CEIL - night * 0.62);
	const groundBrightnessMin = $derived(0.01 * (1 - night) ** 2);

	/**
	 * How strongly the city-lights raster shows. Ramped on night^1.5 so it stays
	 * out of dusk — a linear fade puts lights on a sky that is still blue.
	 */
	const nightLightOpacity = $derived(Math.min(0.9, night ** 1.5));

	/** Lift contrast into the night so features separate crisply. */
	const groundContrast = $derived(IMAGERY_GRADE.contrast + 0.06 + night * 0.38);

	/**
	 * Desaturate INTO the night rather than out of it. Night imagery is still a
	 * daylight photograph; leaving it colour-saturated at low brightness reads
	 * as murky brown rather than as darkness.
	 */
	const groundSaturation = $derived(IMAGERY_GRADE.saturation - night * 0.35);
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

<!-- NIGHT LIGHTS. Sits ABOVE the base imagery and BELOW the detail layer —
     MapLibre draws raster layers in mount order, so this file's order IS the
     stack: ground colour, then the lights on top of it, then any local detail.

     Mounted only while it can be seen, for the same reason the detail layer is:
     a layer at `raster-opacity: 0` still fetches every tile it covers.

     VIIRS is a black frame with bright cities, so at `raster-opacity: night`
     over ground that the grade has already crushed toward black, the dark parts
     of it change nothing and the lit parts read as towns. It only starts to
     matter once the ground is dark, hence the ramp on night^1.5 rather than a
     linear fade that would wash out dusk. -->
{#if nightLightOpacity > 0.01}
	<RasterTileSource
		id="viirs"
		tiles={tiles.viirs}
		tileSize={TILE_SIZE}
		maxzoom={TILE_MAXZOOM.viirs}
	>
		<RasterLayer
			paint={{
				'raster-opacity': nightLightOpacity,
				'raster-fade-duration': IMAGERY_GRADE.fadeDuration,
				'raster-resampling': IMAGERY_GRADE.resampling
			}}
		/>
	</RasterTileSource>
{/if}

<!-- MOUNTED CONDITIONALLY, and that is load-bearing. `raster-opacity: 0` hides
     a layer but does NOT stop it fetching: over Hyderabad, where NAIP has no
     coverage, an invisible layer streamed 404s at the tile server by the
     hundred. A layer that renders nothing must not exist. Has regressed 3x. -->
{#if display.config.detail > 0}
	<RasterTileSource id="usgs" tiles={tiles.usgs} tileSize={TILE_SIZE} maxzoom={TILE_MAXZOOM.usgs}>
		<RasterLayer paint={{ 'raster-opacity': display.config.detail }} />
	</RasterTileSource>
{/if}
