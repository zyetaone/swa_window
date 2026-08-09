<script lang="ts">
	/**
	 * BlindInfoCard — minimal time + location readout when the blind is
	 * CLOSED (covering the scene).
	 *
	 * Time is the USER's wall-clock time (not the simulated scene's local
	 * solar time) — office workers expect their real time on the kiosk.
	 *
	 * Deliberately near-invisible: a quiet, low-contrast watermark on the
	 * cabin-plastic blind, not a prominent UI panel. Open-gesture coaching
	 * lives only on the Blind chevrons (first session) — no second text hint.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { subscribeWallClock, wallClockNow, formatClock } from '$lib/shell/wall-clock.svelte';

	const model = useAeroWindow();

	// Shared wall clock so this and CabinClock never disagree about the minute.
	$effect(() => subscribeWallClock());
	const wallClockTime = $derived(formatClock(wallClockNow()));
</script>

<div class="blind-info">
	<span class="time">{wallClockTime}</span>
	<span class="menu-location">{model.currentLocation.name}</span>
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
		gap: 0.35rem;
		text-align: center;
		pointer-events: none;
		z-index: 200;
	}
	/* Near-invisible watermark — low-contrast ink on the plastic blind. */
	.time {
		font-weight: 300;
		font-size: 2.6rem;
		font-family: 'Ubuntu', system-ui, sans-serif;
		color: rgba(40, 40, 50, 0.22);
		letter-spacing: 0.01em;
	}
	.menu-location {
		font-size: 0.9rem;
		font-weight: 400;
		letter-spacing: 0.04em;
		color: rgba(40, 40, 50, 0.18);
	}
</style>
