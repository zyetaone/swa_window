<script lang="ts">
	/**
	 * Clouds — SVG feTurbulence parallax deck along the horizon.
	 * Density and speed come from model; wind angle is derived from current weather.
	 */
	import CloudBlobs from '$lib/ui/CloudBlobs.svelte';
	import { WEATHER_EFFECTS } from '$lib/constants';
	import type { EffectProps } from '../../types';

	let { model }: EffectProps = $props();

	const windAngle = $derived(WEATHER_EFFECTS[model.weather].windAngle);
</script>

<CloudBlobs
	density={model.effectiveCloudDensity}
	speed={model.cloudSpeed}
	skyState={model.skyState}
	heading={model.flight.heading}
	altitude={model.flight.altitude}
	{windAngle}
/>
