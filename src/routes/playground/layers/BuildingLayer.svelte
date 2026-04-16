<script lang="ts">
	import { FillExtrusionLayer } from 'svelte-maplibre-gl';

	let {
		showBuildings,
		nightFactor,
		nightBrightness,
	}: {
		showBuildings: boolean;
		nightFactor: number;
		nightBrightness: number;
	} = $props();
</script>

<!-- BUILDINGS — 3D extrusions. Warm amber at night with
     height-based brightness (taller = more lit windows). -->
{#if showBuildings}
	<FillExtrusionLayer
		source="openmaptiles"
		sourceLayer="building"
		minzoom={13}
		filter={['!=', ['get', 'hide_3d'], true]}
		paint={{
			'fill-extrusion-color': nightFactor > 0.5
				? [
					'interpolate', ['linear'], ['get', 'render_height'],
					0,   `rgba(25, 22, 18, 0.95)`,
					30,  `rgba(90, 65, 40, 1.0)`,
					80,  `rgba(180, 130, 70, 1.0)`,
					150, `rgba(230, 170, 90, 1.0)`,
					250, `rgba(255, 195, 110, 1.0)`,
					400, `rgba(255, 220, 140, 1.0)`,
				]
				: [
					'interpolate', ['linear'], ['get', 'render_height'],
					0, `rgba(${Math.round(180 * nightBrightness)}, ${Math.round(175 * nightBrightness)}, ${Math.round(165 * nightBrightness)}, 0.85)`,
					200, `rgba(${Math.round(210 * nightBrightness)}, ${Math.round(205 * nightBrightness)}, ${Math.round(195 * nightBrightness)}, 0.95)`,
					400, `rgba(${Math.round(225 * nightBrightness)}, ${Math.round(220 * nightBrightness)}, ${Math.round(210 * nightBrightness)}, 1.0)`,
				],
			'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, ['get', 'render_height']],
			'fill-extrusion-base': ['step', ['zoom'], 0, 14, ['get', 'render_min_height']],
			'fill-extrusion-opacity': nightFactor > 0.5 ? 1.0 : 0.85,
			'fill-extrusion-vertical-gradient': nightFactor < 0.5,
		}}
	/>
{/if}
