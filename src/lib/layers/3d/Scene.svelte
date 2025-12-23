<script lang="ts">
	/**
	 * Scene - Main 3D scene using Threlte extras + custom plugins
	 *
	 * Plugins:
	 * - layers: For selective bloom rendering
	 * - turbulence: Motion noise based on weather
	 * - daynight: Material adjustments for time of day
	 * - selectiveBloom: Bloom only for BLOOM_LAYER objects
	 */
	import { T, useTask } from "@threlte/core";
	import { Float, layers } from "@threlte/extras";
	import EnhancedWing from "./EnhancedWing.svelte";
	import VolumetricClouds from "./VolumetricClouds.svelte";
	import WeatherEffects from "./WeatherEffects.svelte";
	import CityLights from "./CityLights.svelte";
	import { useAppState } from "$lib/core";
	import { turbulence, daynight } from "$lib/plugins";

	const { model } = useAppState();

	// Initialize plugins
	layers();
	turbulence();
	daynight();

	// NOTE: Selective bloom disabled - it hijacks rendering and breaks Cesium transparency
	// TODO: Fix bloom to preserve alpha channel for overlay mode

	// NOTE: Sky and Stars disabled - they render solid backgrounds covering Cesium
	// Using Cesium's native atmosphere instead

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

<!-- 3D Objects -->
<EnhancedWing />
<VolumetricClouds />
<WeatherEffects />
<CityLights />

