<script lang="ts">
	/**
	 * AtmosphereSky — dynamic sky, horizon, and fog blend driven by altitude band.
	 */
	import { Sky } from 'svelte-maplibre-gl';
	import { useAeroWindow } from '#lib/sim/aero-window.svelte.js';

	const windowState = useAeroWindow();

	const rgb = (c: readonly [number, number, number], a = 1) =>
		`rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

	const groundBlend = $derived(Math.min(0.9, windowState.atmosphere.fogDensity * 2200));
</script>

<Sky
	sky-color={rgb(windowState.atmosphere.skyTop)}
	horizon-color={rgb(windowState.atmosphere.skyHorizon)}
	fog-color={rgb(windowState.atmosphere.skyHorizon)}
	sky-horizon-blend={0.6}
	horizon-fog-blend={0.5}
	fog-ground-blend={groundBlend}
	atmosphere-blend={0.5}
/>
