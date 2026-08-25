<script lang="ts">
	/**
	 * Terrain — the shape of the ground: a Terrarium-encoded DEM read from one
	 * local PMTiles archive, driving the 3D elevation mesh, solar hillshading, and optional
	 * hypsometric color relief tinting.
	 */
	import {
		HillshadeLayer,
		RasterDEMTileSource,
		Terrain as TerrainMesh,
		ColorReliefLayer
	} from 'svelte-maplibre-gl';
	import { PMTilesProtocol } from '@svelte-maplibre-gl/pmtiles';
	import type { ExpressionSpecification } from 'maplibre-gl';

	import { HILLSHADE_SHADOW_COLOR, TERRAIN_PMTILES, TILE_SIZE } from '#lib/settings/tiles.js';
	import { useDisplay } from '../display.svelte.js';

	const display = useDisplay();

	// Hypsometric elevation color ramps (geographical, LINZ, etc.)
	const COLOR_RAMPS: Record<string, ExpressionSpecification> = {
		geographical: [
			'interpolate',
			['linear'],
			['elevation'],
			0,
			'rgb(112, 209, 255)',
			1,
			'rgb(112, 209, 255)',
			2,
			'rgb(112, 173, 92)',
			176,
			'rgb(131, 174, 94)',
			529,
			'rgb(166, 176, 97)',
			882,
			'rgb(195, 177, 101)',
			1411,
			'rgb(228, 182, 108)',
			1941,
			'rgb(231, 197, 129)',
			2470,
			'rgb(229, 212, 177)',
			3000,
			'rgb(226, 226, 226)'
		],
		LINZ: [
			'interpolate',
			['linear'],
			['elevation'],
			0,
			'#c0e0ffff',
			3,
			'#548359ff',
			255,
			'#32482dff',
			1000,
			'#32482dff',
			1700,
			'#bfbfb8ff',
			3000,
			'#ffffffff'
		]
	};

	const SUNSET_HOLD_BEARING = 315;
	const night = $derived(display.night ?? 0);
	const sunElev = $derived(display.sun.elevationDeg ?? 30);
	const dayFactor = $derived(Math.max(0, 1 - night));

	const sunBearing = $derived(sunElev > 0 ? display.sun.azimuthDeg : SUNSET_HOLD_BEARING);
	const sunAltitude = $derived(Math.max(5, Math.min(85, sunElev)));
	const exaggeration = $derived(display.config.exaggeration ?? 2.5);

	// Circadian hillshade highlights: warm sunlight in day -> amber dusk -> deep starlight navy at night (never harsh #ffffff)
	const hillshadeHighlightColor = $derived.by(() => {
		if (night > 0.7) return '#0c1424';
		if (sunElev <= 0) return '#1e293b';
		if (sunElev < 12) return '#f59e0b';
		return '#f8eedc';
	});

	// Soften relief highlights at night so nocturnal terrain stays dark and moody
	const effectiveHillshade = $derived(display.config.shade * (0.2 + 0.8 * dayFactor));
</script>

<!-- Registers the pmtiles:// scheme. Must come BEFORE any source that uses it. -->
<PMTilesProtocol />

<RasterDEMTileSource id="dem" url={TERRAIN_PMTILES} encoding="terrarium" tileSize={TILE_SIZE}>
	<!-- 3D Elevation Mesh -->
	<TerrainMesh {exaggeration} />

	<!-- Optional Hypsometric Color Relief Elevation Tint -->
	{#if display.config.colorRelief}
		<ColorReliefLayer
			paint={{
				'color-relief-opacity': 0.75 * dayFactor,
				'color-relief-color': COLOR_RAMPS[display.config.reliefRamp ?? 'geographical']
			}}
		/>
	{/if}

	<!-- Solar-Synchronized Hillshading with Real Sun Compass Bearing, Elevation, and Circadian Highlights -->
	<HillshadeLayer
		paint={{
			'hillshade-method': 'igor',
			'hillshade-exaggeration': effectiveHillshade,
			'hillshade-shadow-color': HILLSHADE_SHADOW_COLOR,
			'hillshade-highlight-color': hillshadeHighlightColor,
			'hillshade-illumination-anchor': 'map',
			'hillshade-illumination-direction': sunBearing,
			'hillshade-illumination-altitude': sunAltitude
		}}
	/>
</RasterDEMTileSource>
