<script lang="ts">
	/**
	 * Clouds — SVG feTurbulence parallax deck along the horizon.
	 * Density and speed come from model; wind angle from weather config.
	 */
	import CloudBlobs from './CloudBlobs.svelte';
	import type { EffectProps } from '$lib/scene/types';

	let { model }: EffectProps = $props();

	const windAngle = $derived(model.config.atmosphere.weather.windAngle);
</script>

<CloudBlobs
	density={model.effectiveCloudDensity}
	speed={model.cloudSpeed}
	skyState={model.skyState}
	heading={model.flight.heading}
	altitude={model.flight.altitude}
	{windAngle}
/>
