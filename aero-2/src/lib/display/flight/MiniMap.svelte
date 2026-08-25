<script lang="ts">
	/**
	 * MiniMap — top-down inset showing the aircraft on its orbit.
	 *
	 * Sync is one-way by design: the frame loop in Stage writes `display.view`
	 * once per frame, and everything here is `$derived` from it. One writer,
	 * many readers. Binding the two maps together would be two writers for one
	 * truth, which is how they drift apart.
	 *
	 * The map is deliberately STATIC — centred on the orbit, never moved. The
	 * first version re-centred on the aircraft every frame, and MapLibre never
	 * finished loading its style: `isStyleLoaded()` stayed false, the GeoJSON
	 * source never became ready, and the track rendered zero features. Type
	 * check, unit tests and the console were all clean; only a screenshot showed
	 * the loop was simply absent. A fixed camera also costs the Pi nothing.
	 *
	 * The aircraft is a DOM marker positioned by projecting lat/lon through the
	 * map — no second GL layer, and it updates with the pose rather than a frame
	 * behind it.
	 */
	import {
		MapLibre,
		RasterTileSource,
		RasterLayer,
		GeoJSONSource,
		LineLayer
	} from 'svelte-maplibre-gl';
	import type { Map as MlMap } from 'maplibre-gl';

	import { useDisplay } from '../display.svelte.js';
	import { FlightTrack, ALTITUDE_CEILING_M } from './orbit.js';
	import { TILE_MAXZOOM, TILE_SIZE, tileTemplates } from '#lib/settings/tiles.js';

	interface Props {
		/** Fixed zoom. Low enough to hold the whole ~55 km orbit. */
		zoom?: number;
	}
	const { zoom = 7.4 }: Props = $props();

	const display = useDisplay();
	const tiles = tileTemplates();

	let map = $state<MlMap | undefined>();

	const place = $derived(display.config.place);

	/**
	 * The ring changes only with place and direction, never per frame —
	 * recomputing 240 poses every frame would be pure waste on the Pi.
	 */
	const ring = $derived(
		new FlightTrack(
			place.lat,
			place.lon,
			display.config.floorM,
			display.config.ceilingM,
			display.config.direction
		).groundTrack()
	);

	const trackGeoJson = $derived({
		type: 'Feature' as const,
		properties: {},
		geometry: { type: 'LineString' as const, coordinates: ring }
	});

	/** Live pose, straight off the view the main window just drew. */
	const lat = $derived(display.view.lat ?? place.lat);
	const lon = $derived(display.view.lon ?? place.lon);
	const heading = $derived(display.view.planeHeadingDeg ?? 0);
	const aglM = $derived(display.view.aglM ?? 0);

	/** Climb bar, 0..1 of the ceiling — the altitude is always moving. */
	const climb = $derived(Math.min(1, aglM / ALTITUDE_CEILING_M));

	/**
	 * Project the aircraft to pixels within the inset.
	 *
	 * `map.project` is a pure read, so this stays a `$derived` off the pose and
	 * never touches the map's camera.
	 */
	const marker = $derived.by(() => {
		const m = map;
		if (!m) return null;
		const p = m.project([lon, lat]);
		return { x: p.x, y: p.y };
	});
</script>

<div class="minimap">
	<MapLibre
		bind:map
		class="fill"
		style={{ version: 8, sources: {}, layers: [] }}
		center={[place.lon, place.lat]}
		{zoom}
		interactive={false}
		attributionControl={false}
	>
		<RasterTileSource
			id="mini-base"
			tiles={tiles.gibs}
			tileSize={TILE_SIZE}
			maxzoom={TILE_MAXZOOM.gibs}
		>
			<RasterLayer paint={{ 'raster-opacity': 0.55, 'raster-saturation': -0.6 }} />
		</RasterTileSource>

		<GeoJSONSource id="mini-track" data={trackGeoJson}>
			<LineLayer
				layout={{ 'line-cap': 'round', 'line-join': 'round' }}
				paint={{ 'line-color': '#7fd4ff', 'line-width': 1.4, 'line-opacity': 0.9 }}
			/>
		</GeoJSONSource>
	</MapLibre>

	{#if marker}
		<div
			class="plane"
			style:left="{marker.x}px"
			style:top="{marker.y}px"
			style:rotate="{heading}deg"
			aria-hidden="true"
		>
			▲
		</div>
	{/if}

	<!-- Reverse the loop. Writes through the settings object, so the window and
	     the minimap turn together — they read the same direction. -->
	<button
		type="button"
		class="reverse"
		aria-label="Reverse flight direction"
		title="Reverse flight direction"
		onclick={() => display.config.reverse()}
	>
		{display.config.direction === 1 ? '↻' : '↺'}
	</button>

	<div class="climb" aria-hidden="true">
		<div class="climb-fill" style:height="{climb * 100}%"></div>
	</div>

	<div class="readout">
		<span>{(aglM / 1000).toFixed(1)} km · {Math.round(heading)}°</span>
	</div>
</div>

<style>
	.minimap {
		position: absolute;
		right: 1.25rem;
		bottom: 1.25rem;
		width: 190px;
		height: 190px;
		border-radius: 50%;
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.22);
		box-shadow:
			0 8px 28px rgba(0, 0, 0, 0.55),
			inset 0 0 0 1px rgba(255, 255, 255, 0.06);
		background: #04070d;
		z-index: 30;
	}

	.plane {
		position: absolute;
		translate: -50% -50%;
		font-size: 12px;
		line-height: 1;
		color: #fff;
		text-shadow: 0 0 5px rgba(0, 0, 0, 0.95);
		pointer-events: none;
	}

	.reverse {
		position: absolute;
		top: 0.45rem;
		right: 0.45rem;
		width: 1.4rem;
		height: 1.4rem;
		display: grid;
		place-items: center;
		font-size: 0.8rem;
		line-height: 1;
		color: rgba(255, 255, 255, 0.85);
		background: rgba(0, 0, 0, 0.45);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 50%;
		cursor: pointer;
	}
	.reverse:hover {
		background: rgba(0, 0, 0, 0.7);
		color: #fff;
	}

	.climb {
		position: absolute;
		left: 0.5rem;
		top: 50%;
		translate: 0 -50%;
		width: 3px;
		height: 52%;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.16);
		overflow: hidden;
		pointer-events: none;
	}
	.climb-fill {
		position: absolute;
		inset: auto 0 0 0;
		background: linear-gradient(to top, #7fd4ff, #d8f3ff);
		border-radius: 2px;
	}

	.readout {
		position: absolute;
		inset: auto 0 0 0;
		padding: 0.3rem 0 0.55rem;
		text-align: center;
		font-size: 0.5rem;
		letter-spacing: 0.05em;
		font-variant-numeric: tabular-nums;
		color: rgba(255, 255, 255, 0.82);
		background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
		pointer-events: none;
	}

	:global(.minimap .fill) {
		position: absolute;
		inset: 0;
	}
</style>
