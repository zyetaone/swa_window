<script lang="ts">
	/**
	 * BlindInfoCard — minimal time + route readout when the blind is
	 * CLOSED (covering the scene).
	 *
	 * Time is the USER's wall-clock time (not the simulated scene's local
	 * solar time) — office workers expect their real time on the kiosk.
	 *
	 * Route is From → To when a cruise has been stamped (blind pull /
	 * autopilot / fleet hop), e.g. "Dallas → Dubai". Before any hop, just
	 * the current place name. Quiet watermark — not a flight deck.
	 *
	 * Open-gesture coaching lives only on the Blind chevrons (first session).
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { subscribeWallClock, wallClockNow, formatClock } from '$lib/shell/passenger/wall-clock.svelte';

	const model = useAeroWindow();

	// Shared wall clock so this and CabinClock never disagree about the minute.
	$effect(() => subscribeWallClock());
	const wallClockTime = $derived(formatClock(wallClockNow()));
	const hasRoute = $derived(
		!!model.routeFromName
			&& !!model.routeToName
			&& model.routeFromName !== model.routeToName,
	);
</script>

<div class="blind-info">
	<span class="time">{wallClockTime}</span>
	{#if hasRoute}
		<span class="route" aria-label="Flight from {model.routeFromName} to {model.routeToName}">
			<span class="from">{model.routeFromName}</span>
			<span class="arrow" aria-hidden="true">→</span>
			<span class="to">{model.routeToName}</span>
		</span>
	{:else}
		<span class="place">{model.routeLabel}</span>
	{/if}
</div>

<style>
	.blind-info {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		text-align: center;
		pointer-events: none;
		z-index: 200;
		max-width: min(90%, 28rem);
		padding: 0 0.75rem;
	}
	/* Near-invisible watermark — low-contrast ink on the plastic blind. */
	.time {
		font-weight: 300;
		font-size: 2.6rem;
		font-family: 'Ubuntu', system-ui, sans-serif;
		color: rgba(40, 40, 50, 0.22);
		letter-spacing: 0.01em;
	}
	.place,
	.route {
		font-size: 0.95rem;
		font-weight: 400;
		letter-spacing: 0.06em;
		color: rgba(40, 40, 50, 0.2);
		text-transform: uppercase;
		font-family: 'Ubuntu', system-ui, sans-serif;
	}
	.route {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: center;
		gap: 0.35rem 0.55rem;
	}
	.arrow {
		font-weight: 300;
		opacity: 0.65;
		letter-spacing: 0;
	}
	.from,
	.to {
		white-space: nowrap;
	}
</style>
