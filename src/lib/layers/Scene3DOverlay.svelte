<script lang="ts">
	/**
	 * Scene3DOverlay - Enhanced Three.js overlay for realistic flight view
	 *
	 * Renders on top of Cesium with transparent background
	 * Includes: Enhanced wing, volumetric clouds, weather effects, motion
	 */
	import { Canvas } from "@threlte/core";
	import { T } from "@threlte/core";
	import * as THREE from "three";
	import EnhancedWing from "./3d/EnhancedWing.svelte";
	import VolumetricClouds from "./3d/VolumetricClouds.svelte";
	import WeatherEffects from "./3d/WeatherEffects.svelte";
	import MotionUpdater from "./3d/MotionUpdater.svelte";
	import { getViewerState } from "$lib/core/state.svelte";
	import { getMotionSystem } from "$lib/core/MotionSystem.svelte";

	const viewer = getViewerState();
	const motion = getMotionSystem();

	// Motion-adjusted camera position (synced from motion system)
	const cameraOffset = $derived({
		x: motion.state.offsetX,
		y: motion.state.offsetY,
		z: motion.state.offsetZ,
	});

	const cameraRotation = $derived({
		x: motion.state.pitch,
		y: motion.state.yaw,
		z: motion.state.roll,
	});

	// Sync motion to weather
	$effect(() => {
		motion.setTurbulenceFromWeather(viewer.weather);
	});

	// Motion system needs to be updated each frame - handled in InnerScene

	// Dynamic lighting based on time of day
	const sunIntensity = $derived(
		viewer.skyState === "day"
			? 0.8
			: viewer.skyState === "dawn" || viewer.skyState === "dusk"
				? 0.5
				: 0.1,
	);

	const ambientIntensity = $derived(viewer.skyState === "night" ? 0.15 : 0.4);

	// Sun color constants - created once, reused (avoid THREE.Color allocation per frame)
	const SUN_COLORS = {
		dawn: new THREE.Color(1.0, 0.7, 0.5),
		dusk: new THREE.Color(1.0, 0.7, 0.5),
		night: new THREE.Color(0.3, 0.35, 0.5),
		day: new THREE.Color(1.0, 0.98, 0.95),
	} as const;

	// Sun color based on time
	const sunColor = $derived(
		viewer.skyState === "dawn" || viewer.skyState === "dusk"
			? SUN_COLORS.dawn
			: viewer.skyState === "night"
				? SUN_COLORS.night
				: SUN_COLORS.day,
	);

	// Sun position from viewer state
	const sunPosition = $derived<[number, number, number]>([
		viewer.sunPosition.x * 100,
		viewer.sunPosition.y * 100,
		viewer.sunPosition.z * 100,
	]);
</script>

<div class="scene-overlay">
	<Canvas
		createRenderer={(canvas) => {
			return new THREE.WebGLRenderer({
				canvas,
				alpha: true,
				antialias: true,
				powerPreference: "high-performance",
				logarithmicDepthBuffer: true,
			});
		}}
	>
		<!-- Camera with motion offsets -->
		<T.PerspectiveCamera
			makeDefault
			position={[cameraOffset.x, 1 + cameraOffset.y, cameraOffset.z]}
			rotation={[cameraRotation.x, cameraRotation.y, cameraRotation.z]}
			fov={65}
			near={0.1}
			far={500000}
		/>

		<!-- Dynamic ambient light -->
		<T.AmbientLight
			intensity={ambientIntensity}
			color={viewer.skyState === "night" ? 0x404060 : 0xffffff}
		/>

		<!-- Sun/moon directional light -->
		<T.DirectionalLight
			position={sunPosition}
			intensity={sunIntensity}
			color={sunColor}
			castShadow
		/>

		<!-- Hemisphere light for realistic ambient -->
		<T.HemisphereLight
			args={[
				viewer.skyState === "night" ? 0x101030 : 0x87ceeb,
				0x4a3728,
				0.3,
			]}
		/>

		<!-- Motion system updater (engine vibration, turbulence) -->
		<MotionUpdater />

		<!-- Enhanced wing with nav lights and motion -->
		<EnhancedWing />

		<!-- Volumetric clouds -->
		<VolumetricClouds />

		<!-- Weather effects (rain, lightning, contrails) -->
		<WeatherEffects />
	</Canvas>
</div>

<style>
	.scene-overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 10;
	}

	.scene-overlay :global(div) {
		width: 100% !important;
		height: 100% !important;
	}

	.scene-overlay :global(canvas) {
		width: 100% !important;
		height: 100% !important;
		display: block;
	}
</style>
