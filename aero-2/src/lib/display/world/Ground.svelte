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
		groundDetailOpacity,
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

	/**
	 * One grade, applied to every colour source.
	 *
	 * The detail layer used to carry no grade at all — raw NAIP at
	 * `raster-opacity: 1` — while the base underneath it was being crushed
	 * toward black. Two layers of the same photograph, lit differently.
	 */
	const grade = $derived({
		'raster-saturation': groundSaturation,
		'raster-contrast': groundContrast,
		'raster-brightness-max': groundBrightnessMax,
		'raster-brightness-min': groundBrightnessMin,
		'raster-fade-duration': IMAGERY_GRADE.fadeDuration,
		'raster-resampling': IMAGERY_GRADE.resampling
	});

	/**
	 * NAIP is a daylight aerial photograph, so it has no business being visible
	 * at night — and it was, at full opacity, ABOVE the city lights. Every US
	 * location rendered 02:00 as broad daylight with no lights at all, because
	 * MapLibre draws in mount order and this layer mounted last.
	 *
	 * Fading it on daylight fixes the picture and removes the ordering
	 * dependency: at night the only colour left is the graded base, and the
	 * lights are the top layer because they are the only other one. Below the
	 * mount threshold it unmounts, so it also stops fetching z16 tiles for a
	 * surface nobody can see.
	 */
	const detailOpacity = $derived(groundDetailOpacity(display.config.detail, night));

	/**
	 * Colour sources, coarse first. Order here IS draw order: MapLibre stacks
	 * raster layers in the order they are added, and #each preserves it.
	 */
	const colourLayers = $derived(
		[
			{
				id: 'gibs',
				tiles: tiles.gibs,
				maxzoom: TILE_MAXZOOM.gibs,
				opacity: 1,
				attribution: TILE_ATTRIBUTION
			},
			{
				id: 'usgs',
				tiles: tiles.usgs,
				maxzoom: TILE_MAXZOOM.usgs,
				opacity: detailOpacity,
				attribution: undefined
			}
		].filter((l) => l.opacity > 0.01)
	);
</script>

<!-- Base GIBS Satellite Imagery -->
<RasterTileSource
	id="gibs"
	tiles={tiles.gibs}
	tileSize={TILE_SIZE}
	maxzoom={TILE_MAXZOOM.gibs}
	attribution={TILE_ATTRIBUTION}
>
	<RasterLayer paint={{ ...grade, 'raster-opacity': 1.0 }} />
</RasterTileSource>

<!-- Higher-resolution USGS NAIP detail layer where coverage exists.
     MOUNTING IS STRICTLY CONDITIONAL: `raster-opacity: 0` hides a layer but does NOT stop it fetching.
     Over locations without NAIP coverage, an invisible layer would stream 404s at the tile server.
     A layer that renders nothing must not exist. -->
{#if detailOpacity > 0}
	<RasterTileSource
		id="usgs"
		tiles={tiles.usgs}
		tileSize={TILE_SIZE}
		maxzoom={TILE_MAXZOOM.usgs}
	>
		<RasterLayer paint={{ ...grade, 'raster-opacity': detailOpacity }} />
	</RasterTileSource>
{/if}

<!-- NIGHT LIGHTS, on top of all colour. Nothing else is mounted by the time
     this matters — the detail layer fades out on the same curve — so being last
     in this file is enough to be last in the stack.

     VIIRS is a black frame with bright cities, so at `raster-opacity: night`
     over ground the grade has already crushed toward black, the dark parts
     change nothing and the lit parts read as towns. It only starts to matter
     once the ground is dark, hence the ramp on night^1.5 rather than a linear
     fade that would wash out dusk. It carries no grade of its own: it is
     emitted light, not a photograph of a lit surface. -->
{#if nightLightOpacity > 0.01}
	<RasterTileSource id="viirs" tiles={tiles.viirs} tileSize={TILE_SIZE} maxzoom={TILE_MAXZOOM.viirs}>
		<RasterLayer
			paint={{
				'raster-opacity': nightLightOpacity,
				'raster-fade-duration': IMAGERY_GRADE.fadeDuration,
				'raster-resampling': IMAGERY_GRADE.resampling
			}}
		/>
	</RasterTileSource>
{/if}
