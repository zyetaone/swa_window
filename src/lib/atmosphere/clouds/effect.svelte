<script lang="ts">
	/**
	 * Clouds — CSS3D volumetric sprite clouds (spite's technique).
	 *
	 * Replaced the SVG feTurbulence CloudBlobs pipeline in this session
	 * on the user's call: CSS3D becomes the only cloud renderer on `/`.
	 * CloudBlobs kept at sibling path until the deletion commit so
	 * rollback is still a one-line swap if needed.
	 */
	import ArtsyClouds from './ArtsyClouds.svelte';
	import type { EffectProps } from '$lib/scene/types';

	let { model }: EffectProps = $props();
</script>

<ArtsyClouds
	density={model.effectiveCloudDensity}
	speed={model.cloudSpeed}
	heading={model.flight.heading}
	altitude={model.flight.altitude}
	nightFactor={model.nightFactor}
	weather={model.weather}
	skyState={model.skyState}
	cloudScale={1.0}
/>
