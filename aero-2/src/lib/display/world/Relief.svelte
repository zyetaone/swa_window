<script lang="ts">
	/**
	 * Relief — the shape of the ground: a Terrarium-encoded DEM read from one
	 * local PMTiles archive, driving both the 3D terrain mesh and the hillshade.
	 *
	 * Hillshade is free structure — it comes off the DEM already fetched for the
	 * mesh, and it closed the perceived-sharpness gap that far more imagery
	 * resolution was supposed to be needed for.
	 */
	import { HillshadeLayer, RasterDEMTileSource, Terrain } from 'svelte-maplibre-gl';
	import { PMTilesProtocol } from '@svelte-maplibre-gl/pmtiles';

	import {
		HILLSHADE_SHADOW_COLOR,
		TERRAIN_EXAGGERATION,
		TERRAIN_PMTILES,
		TILE_SIZE
	} from '#lib/settings/tiles.js';
	import { useDisplay } from '../display.svelte.js';

	const display = useDisplay();

	/** Bearing held while the sun is down; the terrain is unlit then anyway. */
	const SUNSET_HOLD_BEARING = 315;

	/**
	 * Terrain is lit from wherever the sun actually is, not a fixed north-west.
	 * `illumination-anchor: 'map'` makes the angle a compass bearing, which is
	 * exactly what `sunPosition` returns, so this is a direct hand-off.
	 */
	const sunBearing = $derived(
		display.sun.elevationDeg > 0 ? display.sun.azimuthDeg : SUNSET_HOLD_BEARING
	);
</script>

<!-- Registers the pmtiles:// scheme. Must come BEFORE any source that uses it. -->
<PMTilesProtocol />

<RasterDEMTileSource id="dem" url={TERRAIN_PMTILES} encoding="terrarium" tileSize={TILE_SIZE}>
	<Terrain exaggeration={TERRAIN_EXAGGERATION} />
	<HillshadeLayer
		paint={{
			'hillshade-exaggeration': display.config.shade,
			'hillshade-shadow-color': HILLSHADE_SHADOW_COLOR,
			'hillshade-highlight-color': '#ffffff',
			'hillshade-illumination-anchor': 'map',
			'hillshade-illumination-direction': sunBearing
		}}
	/>
</RasterDEMTileSource>
