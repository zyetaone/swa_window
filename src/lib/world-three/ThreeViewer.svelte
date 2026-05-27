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
	import { PerspectiveCamera, WebGLRenderer } from 'three';
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

		<!-- Atmospheric distance haze. FogExp2 density 7e-6 → terrain at
		     100 km along the forward ray hazes ~40 %, giving proper
		     aerial perspective without obscuring the foreground. Colour
		     close to sky-blue so the horizon fades into the dome. -->
		<T.FogExp2 args={[0x9bbbe6, 7e-6]} attach="fog" />

		<T.PerspectiveCamera
			bind:ref={camera}
			makeDefault
			position={sky.cameraPosition}
			fov={45}
			near={100}
			far={1e9}
		/>

		<!-- Ambient bumped to 0.6 — even when the directional sun is on the
		     opposite hemisphere, the camera-side earth surface keeps a
		     baseline brightness so the user always sees the planet. -->
		<T.AmbientLight intensity={0.6} />
		<T.DirectionalLight
			position={[
				sky.sunDirection[0] * SUN_DISTANCE_M,
				sky.sunDirection[1] * SUN_DISTANCE_M,
				sky.sunDirection[2] * SUN_DISTANCE_M,
			]}
			intensity={2.0}
		/>

		<Stars nightFactor={model.nightFactor} />
		<Sky sunDirection={sky.sunDirection} />
		<Earth
			nightFactor={model.nightFactor}
			nightIntensity={model.nightLightScale}
		/>
		<Clouds density={model.effectiveCloudDensity} />
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
