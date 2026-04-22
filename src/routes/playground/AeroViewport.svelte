<script lang="ts">
	/**
	 * AeroViewport — Unified 3D Simulation Viewport.
	 *
	 * Composes the full high-fidelity simulator stack:
	 *   1. MapLibre Globe (Sentinel-2 satellite, OSM buildings)
	 *   2. LandscapeAbstractionLayer (Three.js GeoJSON water/land abstraction)
	 *   3. Threlte Overlay (ECEF camera, Takram volumetric clouds, atmosphere, Post-FX)
	 */
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import maplibregl from 'maplibre-gl';
	import { Canvas, T } from '@threlte/core';
	import { Geodetic, Ellipsoid } from '@takram/three-geospatial';
	
	import { pg } from './lib/playground-state.svelte';
	import { altitudeToZoom, latZoomAdjust } from './lib/globe-zoom';
	import { addBuildings } from './layers/buildings';
	
	import LandscapeAbstractionLayer from './layers/LandscapeAbstractionLayer.svelte';
	import EffectStack from './layers/EffectStack.svelte';
	import SkyDome from './layers/SkyDome.svelte';
	import TransparentClear from './layers/TransparentClear.svelte';
	import ArtsyClouds from './layers/ArtsyClouds.svelte';

	let {
		lat = 25.2,
		lon = 55.3,
		altitudeMeters = 9144,
		headingDeg = 90,
		pitchDeg = 12,
	}: {
		lat?: number;
		lon?: number;
		altitudeMeters?: number;
		headingDeg?: number;
		pitchDeg?: number;
	} = $props();

	let container = $state<HTMLDivElement | undefined>();
	let map = $state<maplibregl.Map | null>(null);
	let mapReady = $state(false);

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

	const nightFactor = $derived.by(() => {
		const t = pg.timeOfDay;
		if (t >= 18.5 || t <= 5.5) return 1.0;
		if (t >= 7 && t <= 17) return 0.0;
		if (t < 7) return (7 - t) / 1.5;
		return (t - 17) / 1.5;
	});

	let lastLat = lat;

	const cameraTransform = $derived.by(() => {
		const lonRad = lon * DEG2RAD;
		const latRad = lat * DEG2RAD;
		const hRad = headingDeg * DEG2RAD;
		const pRad = pitchDeg * DEG2RAD;

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
			center: [lon, lat],
			zoom: altitudeToZoom(altitudeMeters),
			pitch: 60, bearing: headingDeg,
			attributionControl: false, interactive: false,
		});

		map.on('style.load', () => {
			map!.setProjection({ type: 'globe' });
			mapReady = true;
		});

		return () => { map?.remove(); map = null; };
	});

	$effect(() => {
		if (!map || !mapReady) return;
		const compensated = altitudeToZoom(altitudeMeters) + latZoomAdjust(lastLat, lat);
		map.easeTo({ center: [lon, lat], zoom: compensated, bearing: headingDeg, duration: 250 });
		lastLat = lat;
	});

	$effect(() => {
		if (!map || !mapReady) return;
		addBuildings(map, pg.activeLocation, nightFactor);
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
		<ArtsyClouds density={pg.density} cloudScale={pg.cloudScale} speed={pg.cloudSpeed} heading={pg.heading} altitude={pg.altitude} nightFactor={nightFactor} weather={pg.weather} />
	{/if}
</div>

<style>
	.viewport { position: relative; width: 100%; height: 100%; background: #04060d; overflow: hidden; }
	.map-target { position: absolute; inset: 0; }
	.three-overlay { position: absolute; inset: 0; pointer-events: none; }
	.three-overlay :global(canvas) { background: transparent; }
	:global(.map-target .maplibregl-ctrl-attrib) { display: none !important; }
</style>
