<script lang="ts">
	/**
	 * MiniMap — top-down inset showing the aircraft on its orbit with an elevation profile.
	 *
	 * Displays:
	 * 1. Plan View: Orbit ground track ring, forward-flying aircraft marker (▲),
	 *    and sideways passenger camera sightline to the city center.
	 * 2. Elevation View: Side-profile climb/descent cosine wave with live altitude indicator.
	 */
	import { MapLibre, RasterTileSource, RasterLayer } from 'svelte-maplibre-gl';
	import type { Map as MlMap } from 'maplibre-gl';

	import { useDisplay } from '../display.svelte.js';
	import { FlightTrack, CLIMB_PERIOD_SEC } from './orbit.js';
	import { TILE_MAXZOOM, TILE_SIZE, tileTemplates } from '#lib/settings/tiles.js';

	const BLANK_STYLE = { version: 8 as const, sources: {}, layers: [] };

	interface Props {
		/**
		 * Fixed zoom, chosen so the WHOLE orbit fits inside the circular crop.
		 *
		 * Measured rather than guessed: at 6.9 the projected track was 178 px
		 * wide in a 190 px circle, so its east and west ends were clipped by the
		 * border radius. 6.55 leaves a margin on the diagonal.
		 */
		zoom?: number;
	}
	const { zoom = 6.55 }: Props = $props();

	const display = useDisplay();
	const tiles = tileTemplates();

	let map = $state<MlMap | undefined>();

	const place = $derived(display.config.place);

	/**
	 * Ground track coordinates ring (240 samples).
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

	/** Live pose, straight off the view the main window just drew. */
	const lat = $derived(display.view.lat ?? place.lat);
	const lon = $derived(display.view.lon ?? place.lon);
	const heading = $derived(display.view.planeHeadingDeg ?? 0);
	const aglM = $derived(display.view.aglM ?? 0);
	const wallSec = $derived(display.view.wallSec ?? 0);

	/** Climb bar & elevation phase (0..1). */
	/**
	 * Altitude as a fraction of THIS place's climb envelope.
	 *
	 * Not the global ALTITUDE_FLOOR_M/CEILING_M: Denver's floor is 3000 m (it
	 * has to clear the Front Range) against Hyderabad's 400 m. Normalising
	 * against the constants floated the marker ~17% of the strip off its own
	 * curve over Denver, while looking perfect over Hyderabad, whose envelope
	 * happens to equal the constants.
	 */
	const climb = $derived.by(() => {
		const lo = display.config.floorM;
		const hi = display.config.ceilingM;
		if (hi <= lo) return 0;
		return Math.min(1, Math.max(0, (aglM - lo) / (hi - lo)));
	});
	const climbPhase = $derived((wallSec % CLIMB_PERIOD_SEC) / CLIMB_PERIOD_SEC);

	/**
	 * Project the aircraft marker to pixels within the circular inset.
	 */
	const marker = $derived.by(() => {
		const m = map;
		if (!m) return null;
		const p = m.project([lon, lat]);
		return { x: p.x, y: p.y };
	});

	/**
	 * Project the camera's ground look-at target.
	 */
	const targetMarker = $derived.by(() => {
		const m = map;
		if (!m || display.view.targetLon === undefined || display.view.targetLat === undefined)
			return null;
		const p = m.project([display.view.targetLon, display.view.targetLat]);
		return { x: p.x, y: p.y };
	});

	/**
	 * The whole ground track, projected to pixels and drawn as an SVG path.
	 *
	 * NOT a GeoJSON source + LineLayer, which is the obvious approach and does
	 * not work here: svelte-maplibre-gl queues addSource/addLayer behind
	 * `waitForStyleLoaded`, and against a minimal inline style spec that gate
	 * never opened — the layer existed, with correct data, and rendered zero
	 * features. Raster tiles take a different path and drew fine, which made it
	 * look like a data problem rather than a lifecycle one.
	 *
	 * Projecting ~240 points on place change is cheaper than a second GL layer,
	 * and it cannot fail silently: wrong points means a visibly wrong shape.
	 */
	const pathD = $derived.by(() => {
		const m = map;
		if (!m || !ring.length) return '';
		const pts = ring.map(([rLon, rLat]) => m.project([rLon, rLat]));
		if (pts.length === 0) return '';
		return `M ${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} Z`;
	});

	// Elevation profile wave SVG path (sine/cosine climb waveform)
	const ELEV_WIDTH = 104;
	const ELEV_HEIGHT = 24;
	const elevPathD = $derived.by(() => {
		const points: string[] = [];
		for (let x = 0; x <= ELEV_WIDTH; x += 4) {
			const phase = x / ELEV_WIDTH;
			const normY = (1 - Math.cos(phase * Math.PI * 2)) * 0.5;
			const y = ELEV_HEIGHT - normY * (ELEV_HEIGHT - 4) - 2;
			points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
		}
		return `M ${points.join(' L ')}`;
	});

	const elevDotX = $derived(climbPhase * ELEV_WIDTH);
	const elevDotY = $derived(ELEV_HEIGHT - climb * (ELEV_HEIGHT - 4) - 2);
</script>

<div class="minimap" aria-label="Flight Orbit Minimap">
	<MapLibre
		bind:map
		class="fill"
		style={BLANK_STYLE}
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
			<RasterLayer paint={{ 'raster-opacity': 0.6, 'raster-saturation': -0.4 }} />
		</RasterTileSource>
	</MapLibre>

	<!-- Projected SVG Ground Track & Sightline Overlay -->
	<svg class="track-svg" viewBox="0 0 190 190" aria-hidden="true">
		{#if pathD}
			<path d={pathD} class="track-path-glow" />
			<path d={pathD} class="track-path" />
		{/if}

		<!-- Sideways Passenger Window Sightline -->
		{#if marker && targetMarker}
			<line x1={marker.x} y1={marker.y} x2={targetMarker.x} y2={targetMarker.y} class="sightline" />
			<circle cx={targetMarker.x} cy={targetMarker.y} r="2.5" class="target-dot" />
		{/if}
	</svg>

	<!-- Aircraft Heading Marker (▲ points in flight direction) -->
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

	<!-- Reverse Direction Button -->
	<button
		type="button"
		class="reverse"
		aria-label="Reverse flight direction"
		title="Reverse flight direction"
		onclick={() => display.config.reverse()}
	>
		{display.config.direction === 1 ? '↻' : '↺'}
	</button>

	<!-- Altitude Elevation Waveform Inset (Side View) -->
	<div class="elevation-profile" title="Altitude Profile (Climb & Descent)">
		<svg width={ELEV_WIDTH} height={ELEV_HEIGHT} viewBox="0 0 {ELEV_WIDTH} {ELEV_HEIGHT}">
			<!-- Base Wave Curve -->
			<path d={elevPathD} class="elev-wave" />
			<!-- Active Altitude Dot -->
			<circle cx={elevDotX} cy={elevDotY} r="3" class="elev-dot" />
		</svg>
	</div>

	<!-- Telemetry Footer Readout -->
	<div class="readout">
		<span>{(aglM / 1000).toFixed(1)} km · {Math.round(heading)}° HDG</span>
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
		border: 1px solid rgba(255, 255, 255, 0.25);
		box-shadow:
			0 8px 28px rgba(0, 0, 0, 0.65),
			inset 0 0 0 1px rgba(255, 255, 255, 0.08);
		background: #04070d;
		z-index: 30;
		user-select: none;
	}

	.track-svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.track-path-glow {
		fill: none;
		stroke: rgba(56, 189, 248, 0.4);
		stroke-width: 4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.track-path {
		fill: none;
		stroke: #38bdf8;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.sightline {
		stroke: rgba(56, 189, 248, 0.7);
		stroke-width: 1.2;
		stroke-dasharray: 2 3;
	}

	.target-dot {
		fill: #38bdf8;
		filter: drop-shadow(0 0 4px #38bdf8);
	}

	.plane {
		position: absolute;
		translate: -50% -50%;
		font-size: 13px;
		line-height: 1;
		color: #ffffff;
		text-shadow:
			0 0 6px rgba(0, 0, 0, 1),
			0 0 10px #38bdf8;
		pointer-events: none;
	}

	.reverse {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		width: 1.5rem;
		height: 1.5rem;
		display: grid;
		place-items: center;
		font-size: 0.85rem;
		line-height: 1;
		color: rgba(255, 255, 255, 0.9);
		background: rgba(15, 23, 42, 0.7);
		backdrop-filter: blur(4px);
		border: 1px solid rgba(255, 255, 255, 0.25);
		border-radius: 50%;
		cursor: pointer;
		z-index: 5;
		transition: all 0.15s;
	}
	.reverse:hover {
		background: rgba(56, 189, 248, 0.3);
		color: #fff;
		border-color: #38bdf8;
	}

	.elevation-profile {
		position: absolute;
		/* Sits on the chord above the readout. A wider strip lower down has its
		   ends clipped by the circular border-radius. */
		bottom: 2.1rem;
		left: 50%;
		translate: -50% 0;
		pointer-events: none;
		z-index: 4;
		opacity: 0.85;
	}

	.elev-wave {
		fill: none;
		stroke: rgba(255, 255, 255, 0.35);
		stroke-width: 1.5;
		stroke-dasharray: 2 3;
	}

	.elev-dot {
		fill: #38bdf8;
		stroke: #ffffff;
		stroke-width: 1;
		filter: drop-shadow(0 0 4px #38bdf8);
	}

	.readout {
		position: absolute;
		inset: auto 0 0 0;
		padding: 0.3rem 0 0.35rem;
		text-align: center;
		font-size: 0.52rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		font-variant-numeric: tabular-nums;
		color: rgba(255, 255, 255, 0.9);
		background: linear-gradient(to top, rgba(4, 7, 13, 0.85), transparent);
		pointer-events: none;
		z-index: 5;
	}

	:global(.minimap .fill) {
		position: absolute;
		inset: 0;
	}
</style>
