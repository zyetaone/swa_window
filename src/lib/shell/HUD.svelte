<script lang="ts">
	/**
	 * HUD — passenger chrome over the cabin wall.
	 *
	 *   Blind CLOSED → BlindInfoCard (quiet time + place on the blind)
	 *   Blind OPEN   → TelemetryOverlay (soft destination whisper only;
	 *                  ALT/GS live in SidePanel for operators)
	 *
	 * Role / visibility gates live in `$lib/fleet/parallax.svelte`
	 * (`showsOpenPassengerHud`) — do not re-inline left/right checks here.
	 *
	 * Also owns the aria-live region for flight-transition screen-reader
	 * announcements — that lives here so it narrates regardless of which
	 * visual mode is showing.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { showsOpenPassengerHud } from '$lib/fleet/parallax.svelte';
	import TelemetryOverlay from './hud/TelemetryOverlay.svelte';
	import BlindInfoCard from './hud/BlindInfoCard.svelte';

	const model = useAeroWindow();

	const role = $derived(model.config.camera.parallax.role);
	const showOpenHud = $derived(
		model.config.shell.blindOpen &&
			showsOpenPassengerHud(role, model.config.shell.hudVisible),
	);
	const showClosedBlindInfo = $derived(!model.config.shell.blindOpen);

	// Screen-reader announcement reflecting current flight phase. Derived from
	// the same reactive sources directly; aria-live="polite" handles boundary
	// announcements via text-change detection, no edge tracking needed.
	const liveAnnouncement = $derived.by(() => {
		if (model.flight.isTransitioning && model.flight.cruiseDestinationName) {
			return `Flying to ${model.flight.cruiseDestinationName}`;
		}
		return `Arrived at ${model.currentLocation.name}`;
	});

	// Arrival pause: dim the HUD so the eye lands on the terrain that just
	// resolved. CSS transition makes the dim itself a soft fade.
	const isArrivalHold = $derived(model.flight.flightMode === 'arrival_hold');
</script>

<!-- Screen-reader announcement for flight transitions -->
<div class="sr-only" aria-live="polite" role="status">
	{liveAnnouncement}
</div>

{#if showOpenHud || showClosedBlindInfo}
	<div class={['hud-frame', isArrivalHold && 'dim']}>
		{#if showOpenHud}
			<TelemetryOverlay />
		{:else if showClosedBlindInfo}
			<BlindInfoCard />
		{/if}
	</div>
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
