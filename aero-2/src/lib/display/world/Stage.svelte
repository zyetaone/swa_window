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
	import Buildings from './Buildings.svelte';
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
			const planeAt = new LngLat(v.lon, v.lat);
			const targetAt = new LngLat(v.targetLon, v.targetLat);

			/**
			 * Ask the TERRAIN how high the ground is, do not assume the mean.
			 *
			 * `place.groundElevationM` is one number for a whole city, but the
			 * terrain under the aircraft is a 3D mesh AND it is drawn with
			 * `exaggeration`, so what is rendered is the real elevation times that
			 * factor. Adding AGL to the mean therefore puts the camera INSIDE high
			 * ground: at the climb floor, Hyderabad sat at 900 m against Deccan
			 * highs rendered at 1,750 m, and Denver at 4,600 m against a Front
			 * Range rendered at 10,875 m. The window filled with hillside.
			 *
			 * `queryTerrainElevation` returns the drawn height, exaggeration
			 * included, which is exactly the surface we must stay above. It
			 * returns null before the DEM tile covering that point has loaded, so
			 * the mean remains the fallback — and the floor either way, so a
			 * not-yet-loaded tile can never drop the camera.
			 */
			/**
			 * The FALLBACK must be exaggerated too, or it is not the same quantity.
			 *
			 * `queryTerrainElevation` returns the DRAWN height, exaggeration
			 * included -- that is the whole reason it is asked. The flat mean it
			 * falls back to was raw metres MSL, so the two branches returned
			 * values in different units and the fallback was `exaggeration` times
			 * too low. Nothing showed this while the DEM stopped at 79.9E, because
			 * the fallback only bites where the query returns nothing.
			 *
			 * The moment the Himalayas were packed in, it bit hard: mean 5,000 m
			 * drawn at 2.5x is ~12,500 m, the camera was placed at 5,000 + 3,500
			 * AGL = 8,500 m, and the window went black -- 4 km inside the
			 * mountain. Dubai survived only because a 5 m mean is still 12 m when
			 * exaggerated.
			 */
			const exaggeration = display.config.exaggeration;
			const meanGroundM = display.config.place.groundElevationM * exaggeration;
			const groundAtPlaneM = Math.max(meanGroundM, m.queryTerrainElevation(planeAt) ?? 0);
			const groundAtTargetM = Math.max(meanGroundM, m.queryTerrainElevation(targetAt) ?? 0);

			const cam = m.calculateCameraOptionsFromTo(
				planeAt,
				v.aglM + groundAtPlaneM,
				targetAt,
				groundAtTargetM
			);
			m.jumpTo(cam);
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
		maxPitch={88}
		anisotropicFilterPitch={20}
		attributionControl={false}
	>
		<!-- 3D Spherical Earth Globe Projection & Solar Lighting -->
		<Projection type="globe" />
		<Light anchor="map" position={sunPos} />

		<Ground />
		<Terrain />
		<Buildings />
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
