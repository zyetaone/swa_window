<script lang="ts">
	/**
	 * HUD — dispatcher between two display modes:
	 *   Blind OPEN  → TelemetryOverlay (cinematic ALT / GS / LOC readout)
	 *   Blind CLOSED → BlindInfoCard (centered Aero Window + time + hint)
	 *
	 * Also owns the aria-live region for flight-transition screen-reader
	 * announcements — that lives here (not in either card) because it
	 * should narrate regardless of which mode is showing.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import TelemetryOverlay from './hud/TelemetryOverlay.svelte';
	import BlindInfoCard from './hud/BlindInfoCard.svelte';

	const model = useAeroWindow();

	// Screen-reader announcement reflecting current flight phase. Was an
	// $effect with prev-state memoisation — Svelte 5 anti-pattern (effect
	// writing $state we already had the inputs for). Derived from the same
	// reactive sources directly; aria-live="polite" handles boundary
	// announcements via text-change detection, no edge tracking needed.
	const liveAnnouncement = $derived.by(() => {
		if (model.flight.isTransitioning && model.flight.cruiseDestinationName) {
			return `Flying to ${model.flight.cruiseDestinationName}`;
		}
		return `Arrived at ${model.currentLocation.name}`;
	});

	// Arrival pause (v2 council Q3): when the FSM is in arrival_hold, dim the
	// HUD so the eye lands on the terrain that just resolved. Experience
	// Designer called this "non-negotiable" — without it 8 s of held position
	// reads as a freeze. CSS transition makes the dim itself a soft fade.
	const isArrivalHold = $derived(model.flight.flightMode === 'arrival_hold');
</script>

<!-- Screen-reader announcement for flight transitions -->
<div class="sr-only" aria-live="polite" role="status">
	{liveAnnouncement}
</div>

<div class={['hud-frame', isArrivalHold && 'dim']}>
	{#if model.config.shell.blindOpen}
		<TelemetryOverlay />
	{:else}
		<BlindInfoCard />
	{/if}
</div>

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

	/* Wrapper is a 0-height block; opacity cascades to its absolute-
	   positioned descendants (TelemetryOverlay / BlindInfoCard).
	   display: contents would cleanly fall out of layout but does not
	   honor opacity — CSS-quirk, well-known. Default block is fine
	   because the wrapper produces no layout box of its own beyond what
	   the children declare. */
	.hud-frame {
		transition: opacity 0.6s ease-out;
	}

	.hud-frame.dim {
		opacity: 0.35;
	}
</style>
