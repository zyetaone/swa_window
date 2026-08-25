<script lang="ts">
	/**
	 * DebugReadout — dev-only telemetry strip.
	 */
	import type { WindowView } from '#lib/flight/view.js';
	import type { AtmosphereState } from '#lib/stage/atmosphere.js';
	import { useAeroWindow } from '#lib/sim/context.js';

	interface Props {
		placeId?: string;
		view?: WindowView;
		atmosphere?: AtmosphereState;
		nightFactor?: number;
	}

	const { placeId, view, atmosphere, nightFactor }: Props = $props();
	const windowState = useAeroWindow();

	const activePlaceId = $derived(placeId ?? windowState.params.place.id);
	const activeView = $derived(view ?? windowState.view);
	const activeAtmosphere = $derived(atmosphere ?? windowState.atmosphere);
	const activeNightFactor = $derived(nightFactor ?? windowState.night);
</script>

<p class="readout" aria-live="polite">
	{activePlaceId} · band {activeAtmosphere.bandId} · AGL {Math.round(activeView.aglM)} m · MSL {Math.round(
		activeView.mslM
	)}
	m · track {Math.round(activeView.trackDeg)}° · window {Math.round(activeView.headingDeg)}° · local
	{activeView.timeOfDay.toFixed(2)} h · night {activeNightFactor.toFixed(2)}
</p>

<style>
	.readout {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		margin: 0;
		padding: 0.4rem 0.7rem;
		font:
			11px/1.5 ui-monospace,
			monospace;
		color: rgb(255 255 255 / 0.75);
		background: rgb(0 0 0 / 0.55);
		pointer-events: none;
		z-index: 50;
	}
</style>
