<script lang="ts">
	/**
	 * TelemetryOverlay — soft destination whisper when the blind is OPEN.
	 *
	 * Passenger mode: no ALT / GS / LOCAL, no ORBIT/CRUISE badge. Those live
	 * in SidePanel for operators. On the glass we only name the place while
	 * en route, then fade out — ambient, not a flight deck.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';

	const model = useAeroWindow();
	const destName = $derived(model.flight.cruiseDestinationName ?? '');
	const isCruising = $derived(model.flight.flightMode !== 'orbit');
	// Whisper only while the FSM is between places. Quiet orbit = pure view.
	const showWhisper = $derived(isCruising && destName.length > 0);
</script>

{#if showWhisper}
	<div class="hud-wrapper" aria-hidden="true">
		<div class="whisper">
			<span class="label">En route</span>
			<span class="place">{destName}</span>
		</div>
	</div>
{/if}

<style>
	.hud-wrapper {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 15;
	}
	.whisper {
		position: absolute;
		top: clamp(1rem, 4vmin, 2.5rem);
		right: clamp(1rem, 4vmin, 2.5rem);
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.25rem;
		padding: 0.45rem 0.85rem;
		border-radius: 999px;
		/* Subtle scrim — bare white-on-sky washes out against bright day
		   cloud tops. Deliberately lighter than CabinClock's glass chip:
		   a translucent dark fill only, no backdrop-filter blur pass. */
		background: rgba(8, 12, 22, 0.38);
		color: rgba(255, 255, 255, 0.82);
		text-shadow: 0 1px 8px rgba(0, 0, 0, 0.55), 0 0 18px rgba(0, 0, 0, 0.3);
		animation: whisper-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.label {
		font-size: 0.6rem;
		font-weight: 400;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		opacity: 0.55;
	}
	.place {
		font-size: 1.05rem;
		font-weight: 300;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		font-family: 'Ubuntu', system-ui, sans-serif;
	}
	@keyframes whisper-in {
		from { opacity: 0; transform: translateY(-6px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@media (prefers-reduced-motion: reduce) {
		.whisper { animation: none; }
	}
</style>
