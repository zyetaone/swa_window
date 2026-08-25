<script lang="ts">
	/**
	 * The window. Promoted from the ADR-005 Phase 0 probe on 2026-08-25.
	 * MapLibre is now the only renderer: Cesium's wiring, dependency and
	 * runtime assets were deleted the same day, so there is no fallback route
	 * and no second engine to keep in sync.
	 *
	 * Phase 1 (the Pi 5 side-by-side) has NOT run. This promotion is a dev-time
	 * bet on look and licence, not a measured performance verdict — see
	 * ADR-005 before treating it as settled.
	 *
	 * Drives MapLibre with our OWN pure rules — orbitPose, altitudeAt — so what
	 * is on screen is the real motion model, not a stand-in.
	 */
	import {
		MapLibre,
		RasterDEMTileSource,
		Terrain,
		RasterTileSource,
		RasterLayer,
		HillshadeLayer,
		Sky
	} from 'svelte-maplibre-gl';
	import { LngLat } from 'maplibre-gl';
	import type { Map as MlMap } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { altitudeAt, normalizeHeading, orbitPose } from '#lib/flight/rules.js';
	import { resolveAtmosphere } from '#lib/world/atmosphere/rules.js';
	import { nightLighting } from '#lib/world/lighting/rules.js';
	import { Location } from '#lib/world/locations.js';
	import { resolveLocalHours } from '#lib/flight/clock.js';
	import { lookTarget } from '#lib/experience/probe-camera.js';
	import { gameLoop } from '#lib/window/game-loop.js';
	import { tileServerBase } from '#lib/window/tile-server.js';
	import { DEFAULT_WINDOW_AZIMUTH_DEG, DEFAULT_PITCH_DEG, ORBIT } from '#lib/window/config.js';

	const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
	// `Number('')` is 0 and `Number('abc')` is NaN, and a NaN azimuth silently
	// parks the camera at a NaN target — a black screen with no error. Every
	// knob below goes through here so a typo in a kiosk URL falls back instead.
	const num = (key: string, fallback: number): number => {
		const raw = q.get(key);
		if (raw === null || raw.trim() === '') return fallback;
		const n = Number(raw);
		return Number.isFinite(n) ? n : fallback;
	};
	// Location.byId's own default is hyderabad — the fielded kiosk's home.
	const place = Location.byId(q.get('place'));
	const azimuthDeg = num('azimuth', DEFAULT_WINDOW_AZIMUTH_DEG);
	const pitchDeg = num('pitch', DEFAULT_PITCH_DEG);
	// NAIP covers the US only, so anywhere else would just stream 404s. Bounding
	// box, not a coverage API - ponytail: wrong for Alaska/Hawaii, and that is fine
	// until a location lands there. ?detail=0 forces the GIBS-only floor, which is
	// what Hyderabad gets and therefore what the real kiosk looks like today.
	const inNaipCoverage = place.lat > 24 && place.lat < 50 && place.lon > -125 && place.lon < -66;
	const detail = num('detail', inNaipCoverage ? 1 : 0);

	// The climb envelope is THE open Phase 0 question, so make it a knob rather
	// than a commit. Hyderabad's floor is 400 m AGL, where a screen pixel covers
	// ~0.78 m - finer than any licence-clean imagery on Earth. Try ?floor=2500.
	const floorM = num('floor', place.climbFloorM);
	const ceilingM = num('ceiling', place.climbCeilingM);
	// ?shade=0 to compare. Hillshade is free structure: it comes off the DEM we
	// already fetch, and the eye reads ridgelines as "sharp" far more than pixels.
	const shade = num('shade', 0.35);

	// All three layers go through /api/tiles — a
	// local pack is used when one exists, and remoteTileUrl() in
	// server/tiles.ts is the ONLY place any of these hosts is named. This used
	// to hit AWS/NASA/USGS directly from the client, which meant the window
	// quietly opted out of the offline promise: no local pack was ever
	// consulted, and a kiosk with no route out simply failed instead of
	// falling back to what was on disk.
	const base = tileServerBase();

	// Elevation: terrarium. Open data, and MapLibre decodes it natively — one
	// fetch drives both the displaced mesh and the hillshade below.
	const TERRARIUM = [`${base}/xyz/terrarium/{z}/{x}/{y}.png`];

	// Base colour: NASA GIBS, public domain. Its Level9 grid tops out at z9 =
	// ~306 m/px. That is the ENTIRE reason the ground looked blurry: at 3 000 m
	// AGL and -18 deg, a screen pixel covers ~5.6 m, so z9 is a ~55x upsample.
	// It stays as the floor layer because it never has a hole in it, anywhere.
	const GIBS = [`${base}/xyz/gibs/{z}/{x}/{y}.jpg`];

	// Detail colour: USGS NAIP via The National Map. Public domain (a US federal
	// work), no key, no attribution obligation, z16 = ~2.4 m/px. It is US-ONLY,
	// which is the honest shape of the "all free" constraint: there is no global
	// equivalent. Over Hyderabad this layer is simply absent and GIBS shows through.
	const USGS = [`${base}/xyz/usgs/{z}/{x}/{y}.jpg`];

	let map = $state<MlMap | undefined>();

	let lat = $state(place.lat);
	let lon = $state(place.lon);
	let aglM = $state(place.climbFloorM);
	let trackDeg = $state(0);
	let timeOfDay = $state(12);

	const mslM = $derived(place.groundElevationM + aglM);
	const atmosphere = $derived(resolveAtmosphere(aglM));
	const nightFactor = $derived(nightLighting.factor(timeOfDay));

	const rgb = (c: readonly [number, number, number], a = 1) =>
		`rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

	$effect(() => {
		const m = map;
		if (!m) return;
		return gameLoop.subscribe(() => {
			const wallT = Date.now() / 1000;
			const pose = orbitPose({
				wallT,
				centerLat: place.lat,
				centerLon: place.lon,
				orbitAngle0: 0.5,
				orbitBearingRad: 0,
				direction: 1,
				...ORBIT
			});
			lat = pose.lat;
			lon = pose.lon;
			trackDeg = pose.headingDeg;
			aglM = altitudeAt(wallT, floorM, ceilingM);
			timeOfDay = resolveLocalHours({ timeZone: place.timeZone, utcOffset: place.utcOffset });

			const look = normalizeHeading(trackDeg + azimuthDeg);
			const target = lookTarget(lat, lon, aglM, look, pitchDeg);

			// MapLibre has no free camera (that is Mapbox). This is the real
			// equivalent: put the eye at an ALTITUDE and aim it at a ground point,
			// and let MapLibre derive centre/zoom/bearing/pitch. Altitude actually
			// positions the camera here, rather than being faked through zoom.
			m.jumpTo(
				m.calculateCameraOptionsFromTo(
					new LngLat(lon, lat),
					mslM,
					new LngLat(target.lon, target.lat),
					place.groundElevationM
				)
			);
		});
	});
</script>

<svelte:head><title>aero-2</title></svelte:head>

<div class="probe">
	<MapLibre
		bind:map
		class="fill"
		style={{ version: 8, sources: {}, layers: [] }}
		center={[place.lon, place.lat]}
		zoom={11}
		attributionControl={{ compact: true }}
	>
		<RasterTileSource
			id="gibs"
			tiles={GIBS}
			tileSize={256}
			maxzoom={9}
			attribution="Imagery: NASA EOSDIS GIBS, USGS The National Map · Elevation: Mapzen / AWS Open Data"
		>
			<RasterLayer paint={{ 'raster-opacity': 1 }} />
		</RasterTileSource>

		<!-- ponytail: two raster layers IS the detail system. No splat map, no
		     PBR blending - MapLibre already fades between zoom levels and skips
		     tiles it cannot fetch. Reach for a shader when this stops working. -->
		<RasterTileSource id="usgs" tiles={USGS} tileSize={256} maxzoom={16}>
			<RasterLayer paint={{ 'raster-opacity': detail }} />
		</RasterTileSource>

		<RasterDEMTileSource
			id="dem"
			tiles={TERRARIUM}
			encoding="terrarium"
			tileSize={256}
			maxzoom={13}
		>
			<Terrain exaggeration={1} />
			<!-- Declared after the imagery so it draws over it. Same source as the
			     terrain mesh - one fetch, two uses. -->
			<HillshadeLayer
				paint={{ 'hillshade-exaggeration': shade, 'hillshade-shadow-color': '#1a2436' }}
			/>
		</RasterDEMTileSource>

		<Sky
			sky-color={rgb(atmosphere.skyTop)}
			horizon-color={rgb(atmosphere.skyHorizon)}
			fog-color={rgb(atmosphere.skyHorizon)}
			sky-horizon-blend={0.6}
			horizon-fog-blend={0.5}
			fog-ground-blend={Math.min(0.9, atmosphere.fogDensity * 2200)}
		/>
	</MapLibre>

	{#if import.meta.env.DEV}
		<p class="readout">
			{place.id} · band {atmosphere.bandId} · AGL {Math.round(aglM)} m · MSL {Math.round(mslM)} m · track
			{Math.round(trackDeg)}° · window {Math.round(normalizeHeading(trackDeg + azimuthDeg))}° ·
			local {timeOfDay.toFixed(2)} h · night {nightFactor.toFixed(2)}
		</p>
	{/if}
</div>

<style>
	.probe {
		position: fixed;
		inset: 0;
		background: #000;
	}
	:global(.fill) {
		position: absolute;
		inset: 0;
	}
	.readout {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		margin: 0;
		padding: 0.4rem 0.7rem;
		font:
			11px/1.5 ui-monospace,
			monospace;
		color: rgb(255 255 255 / 0.75);
		background: rgb(0 0 0 / 0.55);
		pointer-events: none;
	}
</style>
