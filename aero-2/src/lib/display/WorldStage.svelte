<script lang="ts">
	/**
	 * WorldStage — WebGL MapLibre viewport rendering terrain, NASA GIBS imagery,
	 * USGS NAIP detail tiles, AWS DEM elevation hillshading, and dynamic atmosphere sky.
	 */
	import {
		CustomControl,
		HillshadeLayer,
		MapLibre,
		RasterDEMTileSource,
		RasterLayer,
		RasterTileSource,
		Sky,
		Terrain
	} from 'svelte-maplibre-gl';
	import { PMTilesProtocol } from '@svelte-maplibre-gl/pmtiles';
	import type { Map as MlMap } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import {
		HILLSHADE_SHADOW_COLOR,
		IMAGERY_GRADE,
		TERRAIN_EXAGGERATION,
		TERRAIN_PMTILES,
		TILE_ATTRIBUTION,
		TILE_MAXZOOM,
		TILE_SIZE,
		tileTemplates
	} from '#lib/config.js';
	import { useDisplay } from './display.svelte.js';

	const display = useDisplay();
	const tiles = tileTemplates();

	let map = $state<MlMap | undefined>();
	let pitch = $state(60);

	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
	const pan = (dx: number) => map?.panBy([dx, 0], { duration: 300 });
	const look = (deg: number) => (pitch = clamp(pitch + deg, 0, 85));

	const rgb = (c: readonly [number, number, number], a = 1) =>
		`rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

	const groundBlend = $derived(Math.min(0.9, display.atmosphere.fogDensity * 2200));
</script>

<div class="world-stage">
	<MapLibre
		bind:map
		class="fill"
		style={{ version: 8, sources: {}, layers: [] }}
		center={[display.config.place.lon, display.config.place.lat]}
		zoom={9}
		bind:pitch
		anisotropicFilterPitch={20}
		attributionControl={{ compact: true }}
	>
		<!-- 1. Base GIBS Satellite Imagery -->
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

		<!-- 2. Conditional USGS High-Res Detail (mounted conditionally to prevent 404 storms) -->
		{#if display.config.detail > 0}
			<RasterTileSource
				id="usgs"
				tiles={tiles.usgs}
				tileSize={TILE_SIZE}
				maxzoom={TILE_MAXZOOM.usgs}
			>
				<RasterLayer paint={{ 'raster-opacity': display.config.detail }} />
			</RasterTileSource>
		{/if}

		<!-- 3. DEM 3D Terrain & Hillshade (PMTiles protocol must precede source) -->
		<PMTilesProtocol />
		<RasterDEMTileSource id="dem" url={TERRAIN_PMTILES} encoding="terrarium" tileSize={TILE_SIZE}>
			<Terrain exaggeration={TERRAIN_EXAGGERATION} />
			<HillshadeLayer
				paint={{
					'hillshade-exaggeration': display.config.shade,
					'hillshade-shadow-color': HILLSHADE_SHADOW_COLOR,
					'hillshade-highlight-color': '#ffffff',
					'hillshade-illumination-anchor': 'map',
					'hillshade-illumination-direction': 315
				}}
			/>
		</RasterDEMTileSource>

		<!-- 4. Dynamic Sky & Atmosphere Blend -->
		<Sky
			sky-color={rgb(display.atmosphere.skyTop)}
			horizon-color={rgb(display.atmosphere.skyHorizon)}
			fog-color={rgb(display.atmosphere.skyHorizon)}
			sky-horizon-blend={0.6}
			horizon-fog-blend={0.5}
			fog-ground-blend={groundBlend}
			atmosphere-blend={0.5}
		/>

		<!-- 5. Camera Look & Pan Controls -->
		<CustomControl position="bottom-right" class="look-controls">
			<button type="button" onclick={() => look(10)} aria-label="Show more sky">▲</button>
			<div class="row">
				<button type="button" onclick={() => pan(-120)} aria-label="Pan left">◀</button>
				<button type="button" onclick={() => pan(120)} aria-label="Pan right">▶</button>
			</div>
			<button type="button" onclick={() => look(-10)} aria-label="Show more ground">▼</button>
		</CustomControl>
	</MapLibre>
</div>

<style>
	.world-stage {
		position: absolute;
		inset: 0;
	}
	:global(.fill) {
		position: absolute;
		inset: 0;
	}
	:global(.look-controls) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		margin: 0 16px 16px 0;
	}
	:global(.look-controls) .row {
		display: flex;
		gap: 40px;
	}
	:global(.look-controls) button {
		width: 40px;
		height: 40px;
		border: none;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.45);
		color: #fff;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}
	:global(.look-controls) button:hover {
		background: rgba(0, 0, 0, 0.65);
	}
</style>
