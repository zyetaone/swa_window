<script lang="ts">
	/**
	 * BlindInfoCard — minimal time + location readout when the blind is
	 * CLOSED (covering the scene).
	 *
	 * Time is the USER's wall-clock time (not the simulated scene's local
	 * solar time) — office workers expect their real time on the kiosk.
	 *
	 * Deliberately near-invisible: a quiet, low-contrast watermark on the
	 * cabin-plastic blind, not a prominent UI panel. The blind itself is
	 * the surface; this is just a faint glance of time + place.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { subscribeWallClock, wallClockNow, formatClock } from '$lib/shell/wall-clock.svelte';

	const model = useAeroWindow();

	// Shared wall clock. This used to run its own 30 s interval plus a `_tick`
	// counter read inside the derived purely to force invalidation — a pattern
	// that also let this card and the CabinClock disagree by up to 30 s. The
	// module's $state makes the dependency direct, and one interval serves
	// every consumer.
	$effect(() => subscribeWallClock());
	const wallClockTime = $derived(formatClock(wallClockNow()));
</script>

<div class="blind-info">
	<span class="time">{wallClockTime}</span>
	<span class="menu-location">{model.currentLocation.name}</span>
	<span class="hint">Drag up to open</span>
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
	/* Near-invisible watermark — low-contrast ink on the plastic blind.
	   Reads only as a faint glance, never competes with the blind texture. */
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
	.hint {
		font-size: 0.65rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: rgba(40, 40, 50, 0.3);
		margin-top: 0.75rem;
	}
</style>
