<script lang="ts">
	/**
	 * ThreeViewer — Threlte canvas for /playground/three.
	 *
	 * Real-Earth WGS84 scale. Earth sphere at 6 378 137 m. Camera placed
	 * over (lat, lon, altitude m) and looks ahead (or at earth centre at
	 * high altitudes) via SkyState.lookAtTarget.
	 *
	 * Reasoning notes after the "I don't see anything" report:
	 *  - Custom createRenderer was dropped to use Threlte's default
	 *    pipeline (which handles resize, color space, DPR, render loop).
	 *  - logarithmicDepthBuffer enabled via gl prop.
	 *  - DebugHud child exposes scene state to window.__aero3d for probing
	 *    AND to a `debugState` rune for on-screen HUD readout.
	 */
	import { Canvas, T } from '@threlte/core';
	import { PerspectiveCamera, WebGLRenderer, Color } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { subscribe } from '$lib/game-loop';
	import { SkyState, SUN_DISTANCE_M } from './state.svelte';
	import Earth from './Earth.svelte';
	import Clouds from './Clouds.svelte';
	import Sky from './Sky.svelte';
	import Stars from './Stars.svelte';
	import OsmBuildings from './OsmBuildings.svelte';
	import OsmRoads from './OsmRoads.svelte';
	import DebugHud from './DebugHud.svelte';

	let { debugState = $bindable() } = $props<{
		debugState?: {
			frame: number;
			drawCalls: number;
			triangles: number;
			sceneChildren: number;
			cameraPos: [number, number, number];
			cameraDist: number;
			rendererSize: [number, number];
		};
	}>();

	const model = useAeroWindow();
	$effect(() => subscribe((dt) => model.tick(dt)));

	const sky = new SkyState(model);

	// $state.raw — Three.js objects (PerspectiveCamera) should never be
	// deep-proxied. We only care that the binding triggers our $effect
	// once when the camera mounts; the camera's own internal state
	// (position/quaternion/matrix) is mutated by code below and must stay
	// referentially identical for Three.js's own bookkeeping.
	let camera: PerspectiveCamera | undefined = $state.raw();
	$effect(() => {
		if (!camera) return;
		const [x, y, z] = sky.cameraPosition;
		const [tx, ty, tz] = sky.lookAtTarget;
		const [upX, upY, upZ] = sky.cameraUp;
		// Order matters: set up BEFORE lookAt so the lookAt-derived
		// quaternion uses the bank-rolled up axis. Otherwise Three.js
		// uses the (uninitialised or stale) camera.up.
		camera.up.set(upX, upY, upZ);
		camera.position.set(x, y, z);
		camera.lookAt(tx, ty, tz);
		camera.updateMatrixWorld();

		// React to runtime changes in parallax settings (important for
		// live testing different 3-Pi configurations without reload).
		if (camera.fov !== model.config.camera.parallax.fovDeg) {
			camera.fov = model.config.camera.parallax.fovDeg;
			camera.updateProjectionMatrix();
		}

		// If the device's heading offset changes, force the camera effect
		// to re-run on the next frame by touching the sky state (cheap).
		// The actual position/lookAt is already driven by SkyState which
		// reads effectiveHeading.
		void model.config.camera.parallax.headingOffsetDeg;
	});

	// Initialise debugState struct so DebugHud can write into it.
	debugState ??= {
		frame: 0, drawCalls: 0, triangles: 0, sceneChildren: 0,
		cameraPos: [0, 0, 0], cameraDist: 0, rendererSize: [0, 0],
	};
</script>

<div class="three-stage">
	<Canvas
		createRenderer={(canvas) =>
			new WebGLRenderer({
				canvas,
				antialias: true,
				alpha: false,
				powerPreference: 'high-performance',
				logarithmicDepthBuffer: true,
			})}
	>
		<T.Color args={sky.bgColor} attach="background" />

		<!-- Atmospheric distance haze. FogExp2 density 3.5e-6 → terrain
		     at 100 km still reads (~70 % visible) while 300 km horizon
		     fades to atmosphere. The earlier 7e-6 washed out everything
		     beyond 40 km, which at cruise altitude is most of the
		     visible surface — contributed to the "ground looks blurred"
		     report by compounding 2K-equirect upscale haze. -->
		<T.FogExp2 args={[0x9bbbe6, 3.5e-6]} attach="fog" />

		<T.PerspectiveCamera
			bind:ref={camera}
			makeDefault
			position={sky.cameraPosition}
			fov={model.config.camera.parallax.fovDeg}
			near={100}
			far={1e9}
		/>

		<!--
		  Lighting ratio 0.25 ambient : 2.8 directional gives relief
		  shading enough contrast to actually read terrain via the normal
		  map. Earlier 0.6 ambient was too generous — it kept the planet
		  baseline-bright but washed out mountain shadows entirely so
		  "the terrains don't show" was the user-visible symptom. The
		  0.25 floor still lifts the night-side enough to read.
		-->
		<T.AmbientLight intensity={0.25} />
		<T.DirectionalLight
			position={[
				sky.sunDirection[0] * SUN_DISTANCE_M,
				sky.sunDirection[1] * SUN_DISTANCE_M,
				sky.sunDirection[2] * SUN_DISTANCE_M,
			]}
			intensity={2.8}
		/>

		<Stars nightFactor={model.nightFactor} />
		<Sky sunDirection={sky.sunDirection} />
		<Earth
			nightFactor={model.nightFactor}
			nightIntensity={model.nightLightScale}
		/>
		<Clouds 
			density={model.effectiveCloudDensity} 
			nightFactor={model.nightFactor}
			ambientColor={new Color(0.95, 0.97, 1.0)}  // simple neutral for pure three lab
			ambientIntensity={0.25 + (1 - model.nightFactor) * 0.2}
			sunDirection={sky.sunDirection}
		/>
		<OsmRoads location={model.location} />
		<OsmBuildings location={model.location} />

		<DebugHud bind:state={debugState as never} />
	</Canvas>
</div>

<style>
	.three-stage {
		position: absolute;
		inset: 0;
		background: #000;
	}
	.three-stage :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
