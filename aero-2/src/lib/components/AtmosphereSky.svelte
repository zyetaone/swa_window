<script lang="ts">
	/**
	 * The sky, driven by the atmosphere band the aircraft is currently in.
	 */
	import { Sky } from 'svelte-maplibre-gl';

	import type { AtmosphereState } from '#lib/world/atmosphere/rules.js';

	interface Props {
		atmosphere: AtmosphereState;
	}

	const { atmosphere }: Props = $props();

	const rgb = (c: readonly [number, number, number], a = 1) =>
		`rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

	// fogDensity is a physical-ish 1e-4 scale; MapLibre's blend wants 0..1.
	const groundBlend = $derived(Math.min(0.9, atmosphere.fogDensity * 2200));
</script>

<Sky
	sky-color={rgb(atmosphere.skyTop)}
	horizon-color={rgb(atmosphere.skyHorizon)}
	fog-color={rgb(atmosphere.skyHorizon)}
	sky-horizon-blend={0.6}
	horizon-fog-blend={0.5}
	fog-ground-blend={groundBlend}
/>
