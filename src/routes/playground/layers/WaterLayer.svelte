<script lang="ts">
	import { FillLayer, LineLayer } from 'svelte-maplibre-gl';
	import { pg } from '../lib/playground-state.svelte';

	let {
		waterColor,
		waterOpacity,
		shoreColor,
		nightWaterColor,
		nightWaterOpacity,
		nightFactor = undefined,
	}: {
		waterColor: string;
		waterOpacity: number;
		shoreColor: string;
		nightWaterColor: string;
		nightWaterOpacity: number;
		nightFactor?: number;
	} = $props();

	const effectiveNightFactor = $derived(nightFactor ?? (() => {
		const t = pg.timeOfDay;
		if (t >= 7 && t <= 18) return 0;
		if (t < 5 || t > 22) return 1;
		if (t < 7) return 1 - (t - 5) / 2;
		return (t - 18) / 4;
	})());
</script>

<!-- WATER — ocean/lake/river fill with animated shimmer color +
     pulsing shore outline for coastline wave effect. -->
<FillLayer
	id="water-shimmer"
	source="openmaptiles"
	sourceLayer="water"
	minzoom={3}
	paint={{
		'fill-color': waterColor,
		'fill-opacity': waterOpacity,
		'fill-outline-color': shoreColor,
		'fill-antialias': true,
	}}
/>

<!-- HDR COASTAL BLOOM — Blurred glowing stroke along coastlines
     peaking in intensity at dawn/dusk to simulate light bloom. -->
<LineLayer
	id="water-bloom"
	source="openmaptiles"
	sourceLayer="water"
	minzoom={3}
	paint={{
		'line-color': 'rgba(255, 255, 255, 0.4)',
		'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 10, 4, 14, 12],
		'line-blur': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 3, 14, 10],
		'line-opacity': Math.max(0, 1 - Math.abs(effectiveNightFactor - 0.5) * 2.5),
	}}
/>

<!-- WATER NIGHT GLOW — warm amber reflection on water bodies at night. -->
{#if effectiveNightFactor > 0.15}
	<FillLayer
		id="water-night-glow"
		source="openmaptiles"
		sourceLayer="water"
		minzoom={6}
		paint={{
			'fill-color': nightWaterColor,
			'fill-opacity': nightWaterOpacity,
		}}
	/>
{/if}
