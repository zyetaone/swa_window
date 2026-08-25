<script lang="ts">
	/**
	 * Air — the sky dome and the haze between the window and the ground.
	 *
	 * Colours come from the altitude band the aircraft is in, so the view
	 * thickens and blues as it climbs. Named `Air` rather than `Sky` because
	 * `<Sky>` is the MapLibre component it renders — two things called Sky in
	 * one file is how the last naming collision started.
	 */
	import { Sky } from 'svelte-maplibre-gl';
	import { useDisplay } from '../display.svelte.js';

	const display = useDisplay();

	const rgb = (c: readonly [number, number, number], a = 1) =>
		`rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

	const groundBlend = $derived(Math.min(0.9, display.atmosphere.fogDensity * 2200));
</script>

<Sky
	sky-color={rgb(display.atmosphere.skyTop)}
	horizon-color={rgb(display.atmosphere.skyHorizon)}
	fog-color={rgb(display.atmosphere.skyHorizon)}
	sky-horizon-blend={0.6}
	horizon-fog-blend={0.5}
	fog-ground-blend={groundBlend}
	atmosphere-blend={0.5}
/>
