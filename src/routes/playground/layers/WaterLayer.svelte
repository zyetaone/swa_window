<script lang="ts">
	import { FillLayer, LineLayer } from 'svelte-maplibre-gl';

	let {
		waterColor,
		waterOpacity,
		shoreColor,
		nightWaterColor,
		nightWaterOpacity,
		nightFactor,
	}: {
		waterColor: string;
		waterOpacity: number;
		shoreColor: string;
		nightWaterColor: string;
		nightWaterOpacity: number;
		nightFactor: number;
	} = $props();
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
		'line-opacity': Math.max(0, 1 - Math.abs(nightFactor - 0.5) * 2.5),
	}}
/>

<!-- WATER NIGHT GLOW — warm amber reflection on water bodies at night. -->
{#if nightFactor > 0.15}
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
