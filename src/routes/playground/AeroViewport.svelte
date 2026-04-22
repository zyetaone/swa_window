<script lang="ts">
	/**
	 * AeroViewport — Unified 3D Simulation Viewport.
	 *
	 * Composes the full high-fidelity simulator stack:
	 *   1. MapLibre Globe (Sentinel-2 satellite, OSM buildings)
	 *   2. LandscapeAbstractionLayer (Three.js GeoJSON water/land abstraction)
	 *   3. Threlte Overlay (ECEF camera, Takram volumetric clouds, atmosphere, Post-FX)
	 */
	import { onMount, untrack } from 'svelte';
	import * as THREE from 'three';
	import maplibregl from 'maplibre-gl';
	import { Canvas, T } from '@threlte/core';
	import { Geodetic, Ellipsoid } from '@takram/three-geospatial';
	
	import { pg, motion, pgNightFactor, pgTick, pgHeadingOffsetDeg, pgSkyState } from './lib/playground-state.svelte';
	import { altitudeToZoom, latZoomAdjust } from '$lib/simulation/globe';
	import { addBuildings } from './layers/buildings';
	import { simulationCameraConfig as cameraConfig, simulationDirectorConfig as directorConfig } from '$lib/simulation/camera-config';
	import { LOCATION_MAP, LOCATIONS } from '$lib/locations';
	
	import LandscapeAbstractionLayer from './layers/LandscapeAbstractionLayer.svelte';
	import EffectStack from './layers/EffectStack.svelte';
	import SkyDome from './layers/SkyDome.svelte';
	import TransparentClear from './layers/TransparentClear.svelte';
	import ArtsyClouds from './layers/ArtsyClouds.svelte';

	let { isBoosting = false }: { isBoosting?: boolean } = $props();

	let container = $state<HTMLDivElement | undefined>();
	let map = $state<maplibregl.Map | null>(null);
	let mapReady = $state(false);

	// --- Internal State (Map Center) ---
	let mapLat = $state(25.2);
	let mapLon = $state(55.3);

	// --- ECEF Camera Constants ---
	const DEG2RAD = Math.PI / 180;
	const geo = new Geodetic();
	const camPos = new THREE.Vector3();
	const enuFrame = new THREE.Matrix4();
	const east = new THREE.Vector3();
	const north = new THREE.Vector3();
	const up = new THREE.Vector3();
	const forward = new THREE.Vector3();
	const target = new THREE.Vector3();
	const lookMat = new THREE.Matrix4();
	const camQuat = new THREE.Quaternion();
	const tempQuat = new THREE.Quaternion();

	// --- Simulation Derivations (DRYed from +page.svelte) ---
	const currentLocation = $derived(LOCATION_MAP.get(pg.activeLocation) ?? LOCATIONS[0]);
	const paneHeadingOffset = $derived(pgHeadingOffsetDeg());
	
	const viewBearing = $derived(
		(pg.heading - 90 + paneHeadingOffset + motion.motionOffsetX * 1.5 + 360) % 360,
	);
	const cloudDeckBias = $derived((pg.altitude - 28000) / 8000 * 4);
	const viewPitch = $derived(Math.max(58, Math.min(84, 72 + pg.pitchBias + cloudDeckBias + motion.motionOffsetY * 2.5)));
	const altitudeMeters = $derived(pg.altitude * 0.3048);

	const cameraTransform = $derived.by(() => {
		const lonRad = mapLon * DEG2RAD;
		const latRad = mapLat * DEG2RAD;
		const hRad = viewBearing * DEG2RAD;
		const pRad = viewPitch * DEG2RAD;

		geo.set(lonRad, latRad, altitudeMeters);
		geo.toECEF(camPos);

		Ellipsoid.WGS84.getEastNorthUpFrame(camPos, enuFrame);
		east.setFromMatrixColumn(enuFrame, 0);
		north.setFromMatrixColumn(enuFrame, 1);
		up.setFromMatrixColumn(enuFrame, 2);

		forward.copy(north);
		tempQuat.setFromAxisAngle(up, -hRad);
		forward.applyQuaternion(tempQuat);

		const rotatedEast = east.clone().applyQuaternion(tempQuat);
		tempQuat.setFromAxisAngle(rotatedEast, -pRad);
		forward.applyQuaternion(tempQuat).normalize();

		target.copy(camPos).addScaledVector(forward, 1e7);
		lookMat.lookAt(camPos, target, up);
		camQuat.setFromRotationMatrix(lookMat);

		return {
			position: [camPos.x, camPos.y, camPos.z] as [number, number, number],
			quaternion: [camQuat.x, camQuat.y, camQuat.z, camQuat.w] as [number, number, number, number],
		};
	});

	// --- Animation Loop ---
	onMount(() => {
		if (!container) return;
		map = new maplibregl.Map({
			container,
			style: {
				version: 8,
				sources: {
					satellite: {
						type: 'raster',
						tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'],
						tileSize: 256, maxzoom: 14,
						attribution: 'Sentinel-2 cloudless — © EOX IT Services GmbH',
					},
				},
				layers: [
					{ id: 'bg', type: 'background', paint: { 'background-color': '#04060d' } },
					{ id: 'sat', type: 'raster', source: 'satellite', paint: { 'raster-fade-duration': 350 } },
				],
			},
			center: [mapLon, mapLat],
			zoom: altitudeToZoom(altitudeMeters),
			pitch: 60, bearing: viewBearing,
			attributionControl: false, interactive: false,
		});

		map.on('style.load', () => {
			map!.setProjection({ type: 'globe' });
			mapReady = true;
		});

		// Consolidated RAF loop
		let raf: number;
		let last = performance.now();
		let simTime = 0;
		let lastLat = mapLat;

		const loop = (now: number) => {
			const dt = Math.min((now - last) / 1000, 0.1);
			last = now;

			untrack(() => {
				simTime += dt;
				pgTick(dt, now, isBoosting);

				if (pg.autoFly || isBoosting) {
					const loc = currentLocation;
					const a = pg.orbitAngle;
					const t = pg.orbitTilt;
					const ex = pg.orbitMajor * Math.cos(a);
					const ey = pg.orbitMinor * Math.sin(a);
					const latRad = loc.lat * DEG2RAD;
					const cosT = Math.cos(t), sinT = Math.sin(t);
					mapLat = loc.lat + ex * cosT - ey * sinT;
					mapLon = loc.lon + (ex * sinT + ey * cosT) / Math.max(Math.cos(latRad), 0.2);
				}

				motion.tick(dt, {
					time: simTime,
					heading: pg.heading,
					altitude: pg.altitude,
					turbulenceLevel: pg.turbulenceLevel,
					weather: pg.weather,
					camera: cameraConfig,
					director: directorConfig,
					lat: currentLocation.lat,
					lon: currentLocation.lon,
					pitch: viewPitch,
					bankAngle: motion.bankAngle,
					skyState: pgSkyState, nightFactor: pgNightFactor, dawnDuskFactor: 0,
					locationId: pg.activeLocation,
					userAdjustingAltitude: false, userAdjustingTime: false, userAdjustingAtmosphere: false,
					cloudDensity: pg.density, cloudSpeed: pg.cloudSpeed, haze: 0,
				});

				if (map && mapReady) {
					const compensated = altitudeToZoom(altitudeMeters) + latZoomAdjust(lastLat, mapLat);
					map.easeTo({ center: [mapLon, mapLat], zoom: compensated, bearing: viewBearing, duration: 250 });
					lastLat = mapLat;
				}
			});

			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);

		return () => { 
			cancelAnimationFrame(raf);
			map?.remove(); 
			map = null; 
		};
	});

	$effect(() => {
		if (!map || !mapReady) return;
		addBuildings(map, pg.activeLocation, pgNightFactor);
	});
</script>

<div class="viewport">
	<div class="map-target" bind:this={container}></div>

	{#if map && mapReady && pg.abstractionEnabled}
		<LandscapeAbstractionLayer {map} />
	{/if}

	<div class="three-overlay">
		<Canvas toneMapping={THREE.NoToneMapping}>
			<T.PerspectiveCamera
				makeDefault
				position={cameraTransform.position}
				quaternion={cameraTransform.quaternion}
				fov={55} near={10} far={1e8}
			/>
			<T.AmbientLight intensity={0.35} />
			<TransparentClear />
			<SkyDome cameraPos={cameraTransform.position} />
			<EffectStack clouds={pg.cloudMode === 'sim'} postfx={true} />
		</Canvas>
	</div>

	{#if pg.cloudMode === 'artsy'}
		<ArtsyClouds density={pg.density} cloudScale={pg.cloudScale} speed={pg.cloudSpeed} heading={pg.heading} altitude={pg.altitude} nightFactor={pgNightFactor} weather={pg.weather} />
	{/if}
</div>

<style>
	.viewport { position: relative; width: 100%; height: 100%; background: #04060d; overflow: hidden; }
	.map-target { position: absolute; inset: 0; }
	.three-overlay { position: absolute; inset: 0; pointer-events: none; }
	.three-overlay :global(canvas) { background: transparent; }
	:global(.map-target .maplibregl-ctrl-attrib) { display: none !important; }
</style>

