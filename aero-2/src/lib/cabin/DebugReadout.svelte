<script lang="ts">
	/**
	 * DebugReadout — dev-only telemetry strip.
	 */
	import { useAeroWindow } from '#lib/flight/aero-window.svelte.js';

	const windowState = useAeroWindow();
</script>

<p class="readout" aria-live="polite">
	{windowState.params.place.id} · band {windowState.atmosphere.bandId} · AGL {Math.round(
		windowState.view.aglM
	)} m · MSL {Math.round(windowState.view.mslM)}
	m · track {Math.round(windowState.view.trackDeg)}° · window {Math.round(
		windowState.view.headingDeg
	)}° · local
	{windowState.view.timeOfDay.toFixed(2)} h · night {windowState.night.toFixed(2)}
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
