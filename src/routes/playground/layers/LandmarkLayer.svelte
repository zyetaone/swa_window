<script lang="ts">
	import { CircleLayer, GeoJSONSource } from 'svelte-maplibre-gl';
	import { landmarksFor } from '../lib/landmarks';
	import { pg } from '../lib/playground-state.svelte';

	let {
		showLandmarks = undefined,
		nightFactor = undefined,
		locationId = undefined,
	}: {
		showLandmarks?: boolean;
		nightFactor?: number;
		locationId?: string;
	} = $props();

	const effectiveShowLandmarks = $derived(showLandmarks ?? pg.showLandmarks);
	const effectiveNightFactor = $derived(nightFactor ?? (() => {
		const t = pg.timeOfDay;
		if (t >= 7 && t <= 18) return 0;
		if (t < 5 || t > 22) return 1;
		if (t < 7) return 1 - (t - 5) / 2;
		return (t - 18) / 4;
	})());
	const effectiveLocationId = $derived(locationId ?? pg.activeLocation);
</script>

<!-- Curated landmarks — GeoJSON POIs per location, glowing warmly at night.
     Two stacked circle layers: outer soft halo + inner hot core. -->
{#if effectiveShowLandmarks}
	<GeoJSONSource id="landmarks" data={landmarksFor(effectiveLocationId)}>
		<CircleLayer
			id="landmark-halo"
			source="landmarks"
			minzoom={5}
			paint={{
				'circle-color': effectiveNightFactor > 0.3 ? '#ffc878' : '#f0e4c8',
				'circle-radius': [
					'interpolate', ['linear'], ['zoom'],
					5,  ['match', ['get', 'rank'], 1, 3,  2, 2,  3, 1, 1],
					10, ['match', ['get', 'rank'], 1, 10, 2, 7,  3, 4, 4],
					14, ['match', ['get', 'rank'], 1, 20, 2, 14, 3, 8, 8],
				],
				'circle-blur': 2.0,
				'circle-opacity': Math.max(0, (effectiveNightFactor - 0.15) * 0.9),
			}}
		/>
		<CircleLayer
			id="landmark-core"
			source="landmarks"
			minzoom={5}
			paint={{
				'circle-color': effectiveNightFactor > 0.3 ? '#fff2c4' : '#ffffff',
				'circle-radius': [
					'interpolate', ['linear'], ['zoom'],
					5,  ['match', ['get', 'rank'], 1, 1.5, 2, 1,   3, 0.5, 0.5],
					10, ['match', ['get', 'rank'], 1, 4,   2, 3,   3, 2, 2],
					14, ['match', ['get', 'rank'], 1, 7,   2, 5,   3, 3, 3],
				],
				'circle-blur': 0.6,
				'circle-opacity': Math.max(0, (effectiveNightFactor - 0.2) * 1.25),
			}}
		/>
	</GeoJSONSource>
{/if}
