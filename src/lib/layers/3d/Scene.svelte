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
	import { Sky, Stars, Float, layers } from "@threlte/extras";
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
	// const bloom = setupSelectiveBloom({ ... });

	// Sky parameters derived from time of day
	const skyElevation = $derived.by(() => {
		const t = model.localTimeOfDay;
		if (t < 5 || t > 20) return -5;      // Night: sun below horizon
		if (t < 7) return (t - 5) * 15;       // Dawn: 0° to 30°
		if (t < 12) return 30 + (t - 7) * 11; // Morning: 30° to 85°
		if (t < 17) return 85 - (t - 12) * 11;// Afternoon: 85° to 30°
		return 30 - (t - 17) * 10;            // Dusk: 30° to 0°
	});

	const skyAzimuth = $derived(90 + (model.localTimeOfDay - 6) * 15); // East to West
	const skyTurbidity = $derived(model.haze * 15 + 2); // 2-17 based on haze

	// Show stars at night/dusk
	const showStars = $derived(model.skyState === 'night' || model.skyState === 'dusk');
	const starsOpacity = $derived(model.skyState === 'night' ? 1 : 0.4);

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

<!-- Sky disabled - it renders solid background covering Cesium -->
<!-- TODO: Need transparent sky or just use Cesium's atmosphere -->
<!--
<Sky
	elevation={skyElevation}
	azimuth={skyAzimuth}
	turbidity={skyTurbidity}
	rayleigh={model.skyState === 'night' ? 0.1 : 3}
	setEnvironment={true}
/>
-->

<!-- Stars disabled for testing - may cover Cesium -->
<!-- {#if showStars}
	<Stars
		count={3000}
		depth={100}
		radius={80}
		factor={4}
		fade
		opacity={starsOpacity}
		speed={0.2}
	/>
{/if} -->

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

