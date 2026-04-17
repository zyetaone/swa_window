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
				14, ['match', ['get', 'class'], 'motorway', 6.5, 'trunk', 5.2, 'primary', 3.9, 2.3],
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

	<!-- RED SPARK TRAIL — sparse red laser on highways. Production's
	     `trafficRed` palette: 2% of lit pixels get red accent. Achieved
	     here via a thin red line with very low opacity under the white core. -->
	<LineLayer
		id="road-red-spark"
		source="openmaptiles"
		sourceLayer="transportation"
		minzoom={9}
		filter={['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['==', ['get', 'class'], 'motorway']]}
		paint={{
			'line-color': `rgba(255, 80, 60, ${0.35 * nightFactor})`,
			'line-width': [
				'interpolate', ['linear'], ['zoom'],
				9, 0.3,
				14, 1.5
			],
			'line-blur': 0.8,
			'line-opacity': 0.6 * nightFactor,
		}}
	/>
{/if}

<!-- LIGHT POLLUTION CORONA — wide amber disc under each city.
     Simulates atmospheric light scatter visible from altitude.
     Larger blur + lower opacity than city-glow disc. -->
{#if showCityLights && nightFactor > 0.2}
	<CircleLayer
		id="city-corona"
		source="openmaptiles"
		sourceLayer="place"
		minzoom={3}
		filter={['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb']]]}
		paint={{
			// Rank 1-3: mega-cities get wide corona; smaller cities more subtle
			'circle-radius': [
				'interpolate', ['linear'], ['zoom'],
				3, ['case', ['<=', ['get', 'rank'], 3], 18, ['<=', ['get', 'rank'], 6], 12, 6],
				8, ['case', ['<=', ['get', 'rank'], 3], 35, ['<=', ['get', 'rank'], 6], 22, 12],
				12, ['case', ['<=', ['get', 'rank'], 3], 60, ['<=', ['get', 'rank'], 6], 40, 20],
			],
			'circle-color': '#ff8c30',
			'circle-blur': 2.5,
			'circle-opacity': nightFactor * 0.18,
		}}
	/>
{/if}

<!-- CITY GLOW — procedural warm discs on 'place' points.
     Opacity driven by nightFactor + rank amplitude.
     rank 1-3: 1.8× intensity | 4-6: 1.3× | 7+: 0.8× -->
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
				4, ['case', ['<=', ['get', 'rank'], 3], 2.5, ['<=', ['get', 'rank'], 6], 1.2, 0.6],
				10, ['case', ['<=', ['get', 'rank'], 3], 7.5, ['<=', ['get', 'rank'], 6], 4.4, 2.2],
				14, ['case', ['<=', ['get', 'rank'], 3], 11.2, ['<=', ['get', 'rank'], 6], 6.9, 4],
			],
			'circle-blur': 1.5,
			// rank-amplified opacity: mega-cities glow harder at night
			'circle-opacity': [
				'case',
				['<=', ['get', 'rank'], 3], nightFactor * 1.0,
				['<=', ['get', 'rank'], 6], nightFactor * 0.9,
				nightFactor * 0.68,
			],
		}}
	/>
{/if}
