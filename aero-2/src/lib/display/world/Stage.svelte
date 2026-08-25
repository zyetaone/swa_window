<script lang="ts">
	/**
	 * Stage — the MapLibre viewport and the flight loop that drives it.
	 *
	 * Everything visible inside it is a child component: Ground (colour),
	 * Terrain (shape), Sky (air and haze), LookControls (aiming). This file owns
	 * exactly one thing — where the camera is, every frame.
	 */
	import { MapLibre } from 'svelte-maplibre-gl';
	import { LngLat, type Map as MlMap } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { useDisplay } from '../display.svelte.js';
	import Ground from './Ground.svelte';
	import Terrain from './Terrain.svelte';
	import Sky from './Sky.svelte';
	import LookControls from '../flight/LookControls.svelte';

	const BLANK_STYLE = { version: 8 as const, sources: {}, layers: [] };

	/**
	 * An empty style, defined ONCE at module scope.
	 *
	 * Inlining `style={{ version: 8, sources: {}, layers: [] }}` creates a NEW
	 * object on every render. MapLibre treats that as a new style and restarts
	 * loading, so `style._loaded` never settles true — and svelte-maplibre-gl
	 * queues every addSource/addLayer behind `waitForStyleLoaded`, which then never
	 * fires. Raster tiles still drew (they are added a different way), so the only
	 * symptom was that GeoJSON layers silently rendered nothing.
	 */

	const display = useDisplay();

	let map = $state<MlMap | undefined>();

	/**
	 * Fly the plane.
	 *
	 * The camera is positioned by real ALTITUDE and aimed at a real ground
	 * point, via `calculateCameraOptionsFromTo`, rather than faked with a zoom
	 * level.
	 *
	 * Imperative on purpose: `jumpTo` is one call per frame, where driving
	 * center/zoom/pitch/bearing as reactive props would re-diff four of them at
	 * 60 fps for an identical picture. This is the Pi's hot path.
	 */
	$effect(() => {
		const m = map;
		if (!m) return;

		let raf: number;
		const loop = () => {
			const v = display.advanceTo(Date.now() / 1000);
			m.jumpTo(
				m.calculateCameraOptionsFromTo(
					new LngLat(v.lon, v.lat),
					v.aglM + display.config.place.groundElevationM,
					new LngLat(v.targetLon, v.targetLat),
					display.config.place.groundElevationM
				)
			);
			raf = requestAnimationFrame(loop);
		};

		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});
</script>

<div class="world-stage">
	<MapLibre
		bind:map
		class="fill"
		style={BLANK_STYLE}
		center={[display.config.place.lon, display.config.place.lat]}
		zoom={9}
		anisotropicFilterPitch={20}
		attributionControl={{ compact: true }}
	>
		<Ground />
		<Terrain />
		<Sky />
		<LookControls />
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
</style>
