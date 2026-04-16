<script lang="ts">
	import { CircleLayer, LineLayer } from 'svelte-maplibre-gl';

	let {
		nightFactor,
		showCityLights,
	}: {
		nightFactor: number;
		showCityLights: boolean;
	} = $props();
</script>

<!-- ROADS — warm amber glow at night. Per-class sizing: highways
     brightest + widest, side streets dim. -->
{#if nightFactor > 0.1}
	<LineLayer
		id="road-glow"
		source="openmaptiles"
		sourceLayer="transportation"
		minzoom={6}
		filter={['!=', ['get', 'brunnel'], 'tunnel']}
		paint={{
			'line-color': [
				'match', ['get', 'class'],
				'motorway', `rgba(255, 200, 120, ${0.8 * nightFactor})`,
				'trunk',    `rgba(255, 180, 100, ${0.7 * nightFactor})`,
				'primary',  `rgba(255, 170, 90,  ${0.6 * nightFactor})`,
				'secondary',`rgba(230, 155, 80,  ${0.5 * nightFactor})`,
				'tertiary', `rgba(200, 140, 70,  ${0.4 * nightFactor})`,
				/* default */ `rgba(160, 110, 60,  ${0.25 * nightFactor})`,
			],
			'line-width': [
				'interpolate', ['linear'], ['zoom'],
				6,  ['match', ['get', 'class'], 'motorway', 1.2, 'trunk', 0.9, 'primary', 0.6, 0.3],
				10, ['match', ['get', 'class'], 'motorway', 2.5, 'trunk', 2,   'primary', 1.4, 0.8],
				14, ['match', ['get', 'class'], 'motorway', 5,   'trunk', 4,   'primary', 3,   1.8],
			],
			'line-blur': 0.6,
			'line-opacity': 0.85,
		}}
	/>

	<!-- TRAFFIC LIGHT TRAILS — Inner core laser line on arterials. -->
	<LineLayer
		id="road-traffic-core"
		source="openmaptiles"
		sourceLayer="transportation"
		minzoom={8}
		filter={['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]]]}
		paint={{
			'line-color': '#ffffff',
			'line-width': [
				'interpolate', ['linear'], ['zoom'],
				8, 0.4,
				14, 2.0
			],
			'line-blur': 0.3,
			'line-opacity': 0.7 * nightFactor,
		}}
	/>
{/if}

<!-- CITY GLOW — procedural warm discs on 'place' points.
     Opacity driven by nightFactor + flicker (via RAF in parent). -->
{#if showCityLights && nightFactor > 0.15}
	<CircleLayer
		id="city-glow"
		source="openmaptiles"
		sourceLayer="place"
		minzoom={4}
		filter={['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'village']]]}
		paint={{
			'circle-color': '#ffd480',
			'circle-radius': [
				'interpolate', ['linear'], ['zoom'],
				4, ['case', ['<=', ['get', 'rank'], 3], 2, ['<=', ['get', 'rank'], 6], 1, 0.5],
				10, ['case', ['<=', ['get', 'rank'], 3], 5, ['<=', ['get', 'rank'], 6], 3, 1.5],
				14, ['case', ['<=', ['get', 'rank'], 3], 8, ['<=', ['get', 'rank'], 6], 5, 3],
			],
			'circle-blur': 1.8,
			'circle-opacity': nightFactor * 0.6,
		}}
	/>
{/if}
