<script lang="ts">
	/**
	 * HUD — dispatcher between two display modes:
	 *   Blind OPEN  → TelemetryOverlay (cinematic ALT / GS / LOC readout)
	 *   Blind CLOSED → BlindInfoCard (centered Sky Portal + time + hint)
	 *
	 * Also owns the aria-live region for flight-transition screen-reader
	 * announcements — that lives here (not in either card) because it
	 * should narrate regardless of which mode is showing.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import TelemetryOverlay from './hud/TelemetryOverlay.svelte';
	import BlindInfoCard from './hud/BlindInfoCard.svelte';

	const model = useAeroWindow();

	// aria-live tracking — plain var (prev-state memoisation, not reactive).
	let prevTransitioning = false;
	let liveAnnouncement = $state('');

	$effect(() => {
		const transitioning = model.flight.isTransitioning;
		const destination = model.flight.cruiseDestinationName;

		if (transitioning && destination && !prevTransitioning) {
			liveAnnouncement = `Flying to ${destination}`;
		} else if (!transitioning && prevTransitioning) {
			liveAnnouncement = `Arrived at ${model.currentLocation.name}`;
		}

		prevTransitioning = transitioning;
	});
</script>

<!-- Screen-reader announcement for flight transitions -->
<div class="sr-only" aria-live="polite" role="status">
	{liveAnnouncement}
</div>

{#if model.config.shell.blindOpen}
	<TelemetryOverlay />
{:else}
	<BlindInfoCard />
{/if}

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}
</style>
