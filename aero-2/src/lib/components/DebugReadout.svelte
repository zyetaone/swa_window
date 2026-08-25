<script lang="ts">
	/**
	 * Dev-only telemetry strip. Not shipped to the kiosk — `+page.svelte` gates
	 * this on `dev` from `$app/env`, which is statically replaced at build time
	 * and so costs a fielded Pi nothing.
	 */
	import type { WindowView } from '#lib/flight/view.js';
	import type { AtmosphereState } from '#lib/world/atmosphere/rules.js';

	interface Props {
		placeId: string;
		view: WindowView;
		atmosphere: AtmosphereState;
		nightFactor: number;
	}

	const { placeId, view, atmosphere, nightFactor }: Props = $props();
</script>

<p class="readout">
	{placeId} · band {atmosphere.bandId} · AGL {Math.round(view.aglM)} m · MSL {Math.round(view.mslM)}
	m · track {Math.round(view.trackDeg)}° · window {Math.round(view.headingDeg)}° · local
	{view.timeOfDay.toFixed(2)} h · night {nightFactor.toFixed(2)}
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
	}
</style>
