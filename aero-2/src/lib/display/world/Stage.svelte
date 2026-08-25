<script lang="ts">
	/**
	 * Stage — the MapLibre viewport and the flight loop that drives it.
	 *
	 * Everything visible inside it is a child component: Ground (colour),
	 * Terrain (shape), Sky (air and haze), LookControls (aiming). This file owns
	 * exactly one thing — where the camera is, every frame.
	 */
	import { MapLibre, Projection, Light } from 'svelte-maplibre-gl';
	import { LngLat, type Map as MlMap } from 'maplibre-gl';
	// Bundled locally. svelte-maplibre-gl otherwise injects a <link> to unpkg,
	// which CSP blocks — and which a fielded Pi has no internet to fetch. Hence
	// `autoloadGlobalCss={false}` on every MapLibre below.
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { useDisplay } from '../display.svelte.js';
	import Ground from './Ground.svelte';
	import Terrain from './Terrain.svelte';
	import Sky from './Sky.svelte';
	import LookControls from '../flight/LookControls.svelte';

	const BLANK_STYLE = { version: 8 as const, sources: {}, layers: [] };

	const display = useDisplay();

	let map = $state<MlMap | undefined>();
	$effect(() => {
		if (map) (globalThis as unknown as { __stage?: MlMap }).__stage = map;
	});

	/**
	 * Fly the plane.
	 *
	 * The camera is positioned by real ALTITUDE and aimed at a real ground
	 * point, via `calculateCameraOptionsFromTo`, rather than faked with a zoom
	 * level.
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

	// Dynamic spherical solar light vector [r, azimuth, polarAngle]
	const sunPos = $derived.by<[number, number, number]>(() => [
		100,
		display.sun.azimuthDeg,
		Math.max(0, 90 - display.sun.elevationDeg)
	]);
</script>

<div class="world-stage">
	<MapLibre
		bind:map
		autoloadGlobalCss={false}
		class="fill"
		style={BLANK_STYLE}
		center={[display.config.place.lon, display.config.place.lat]}
		zoom={9}
		anisotropicFilterPitch={20}
		attributionControl={{ compact: true }}
	>
		<!-- 3D Spherical Earth Globe Projection & Solar Lighting -->
		<Projection type="globe" />
		<Light anchor="map" position={sunPos} />

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
