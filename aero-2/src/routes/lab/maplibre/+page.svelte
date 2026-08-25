<script lang="ts">
	/**
	 * ADR-005 Phase 0 probe — NOT the ship path.
	 *
	 * The point is to answer the cheap questions before either renderer gets
	 * built: is the orbit still too fast, does the climb read as a ride, is
	 * 3 000 m AGL the right floor over Denver, does terrain matter from 10 km.
	 * All of those are true regardless of renderer.
	 *
	 * It drives MapLibre with our OWN pure rules — orbitPose, altitudeAt — so
	 * what is on screen is the real motion model, not a stand-in.
	 */
	import { MapLibre, RasterDEMTileSource, Terrain, RasterTileSource, RasterLayer, Sky } from 'svelte-maplibre-gl';
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

	const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
	const place = Location.byId(q.get('place') ?? 'denver');
	const azimuthDeg = Number(q.get('azimuth') ?? -90);
	const pitchDeg = Number(q.get('pitch') ?? -18);

	// Elevation: AWS terrarium. Open data, and MapLibre decodes it natively —
	// which is the whole reason this probe costs hours instead of days.
	const TERRARIUM = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];

	// Base colour: NASA GIBS, public domain. ~250 m/px, which is the resolution
	// a 500 km bake would use anyway. GIBS serves {z}/{row}/{col}.
	const GIBS_DATE = '2026-08-20';
	const GIBS = [
		`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${GIBS_DATE}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
	];

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
				majorMin: 0.08,
				majorMax: 0.25,
				breathePeriod: 180,
				driftRate: 3.42e-4,
				flightSpeed: 6,
			});
			lat = pose.lat;
			lon = pose.lon;
			trackDeg = pose.headingDeg;
			aglM = altitudeAt(wallT, place.climbFloorM, place.climbCeilingM);
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
					place.groundElevationM,
				),
			);
		});
	});
</script>

<svelte:head><title>aero-2 probe — maplibre</title></svelte:head>

<div class="probe">
	<MapLibre
		bind:map
		class="fill"
		style={{ version: 8, sources: {}, layers: [] }}
		center={[place.lon, place.lat]}
		zoom={11}
		attributionControl={{ compact: true }}
	>
		<RasterDEMTileSource id="dem" tiles={TERRARIUM} encoding="terrarium" tileSize={256} maxzoom={13}>
			<Terrain exaggeration={1} />
		</RasterDEMTileSource>

		<RasterTileSource
			id="gibs"
			tiles={GIBS}
			tileSize={256}
			maxzoom={9}
			attribution="Imagery: NASA EOSDIS GIBS · Elevation: Mapzen / AWS Open Data"
		>
			<RasterLayer paint={{ 'raster-opacity': 1 }} />
		</RasterTileSource>

		<Sky
			sky-color={rgb(atmosphere.skyTop)}
			horizon-color={rgb(atmosphere.skyHorizon)}
			fog-color={rgb(atmosphere.skyHorizon)}
			sky-horizon-blend={0.6}
			horizon-fog-blend={0.5}
			fog-ground-blend={Math.min(0.9, atmosphere.fogDensity * 2200)}
		/>
	</MapLibre>

	<p class="readout">
		{place.id} · band {atmosphere.bandId} · AGL {Math.round(aglM)} m · MSL {Math.round(mslM)} m ·
		track {Math.round(trackDeg)}° · window {Math.round(normalizeHeading(trackDeg + azimuthDeg))}° ·
		local {timeOfDay.toFixed(2)} h · night {nightFactor.toFixed(2)}
	</p>
</div>

<style>
	.probe { position: fixed; inset: 0; background: #000; }
	:global(.fill) { position: absolute; inset: 0; }
	.readout {
		position: fixed; left: 0; right: 0; bottom: 0; margin: 0;
		padding: 0.4rem 0.7rem;
		font: 11px/1.5 ui-monospace, monospace;
		color: rgb(255 255 255 / 0.75);
		background: rgb(0 0 0 / 0.55);
		pointer-events: none;
	}
</style>
