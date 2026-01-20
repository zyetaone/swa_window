<script lang="ts">
	/**
	 * Scene - Three.js effects overlay for clouds and weather
	 *
	 * Renders on top of Cesium with transparent background.
	 * Terrain, buildings, and atmosphere are handled by Cesium.
	 */
	import { T, useTask } from "@threlte/core";
	import { Float, layers } from "@threlte/extras";
	import VolumetricClouds from "./VolumetricClouds.svelte";
	import WeatherEffects from "./WeatherEffects.svelte";
	import { useAppState } from "$lib/core";
	import { turbulence, daynight } from "$lib/plugins";

	const { model } = useAppState();

	// Initialize plugins
	layers();
	turbulence();
	daynight();

	// Camera base position
	const cameraY = $derived(1 + model.motionOffsetY);

	// Master tick - advances all animation state in model
	useTask('scene-tick', (delta) => {
		model.tick(delta);
	});
</script>

<!-- Camera with Float for turbulence -->
<Float
	floatIntensity={model.turbulenceLevel === 'severe' ? 0.3 : model.turbulenceLevel === 'moderate' ? 0.15 : 0.05}
	speed={model.turbulenceLevel === 'severe' ? 2 : 1}
	rotationIntensity={model.turbulenceLevel === 'severe' ? 0.02 : 0.005}
	rotationSpeed={0.5}
>
	<T.PerspectiveCamera
		makeDefault
		position.y={cameraY}
		fov={65}
		near={0.1}
		far={500000}
	/>
</Float>

<!-- Ambient fill light -->
<T.AmbientLight
	intensity={model.ambientIntensity}
	color={model.skyState === "night" ? 0x404060 : 0xffffff}
/>

<!-- 3D Effects (clouds, weather) - terrain/buildings via Cesium -->
<VolumetricClouds />
<WeatherEffects />


