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

	const model = useAeroWindow();

	// Wall-clock time — re-renders every 30 s (display granularity is
	// minutes). Reading `_tick` inside the derived ties it to the interval.
	let _tick = $state(0);
	$effect(() => {
		const id = setInterval(() => { _tick++; }, 30_000);
		return () => clearInterval(id);
	});
	const wallClockTime = $derived.by(() => {
		void _tick;
		return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	});
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
		color: rgba(40, 40, 50, 0.16);
		margin-top: 0.75rem;
	}
</style>
