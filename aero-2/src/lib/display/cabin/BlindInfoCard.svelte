<script lang="ts">
	/**
	 * BlindInfoCard — minimal time + destination readout when the window blind is closed.
	 * Displays the passenger's local wall-clock time and destination watermark on the blind.
	 */
	import { useDisplay } from '../display.svelte.js';

	const display = useDisplay();

	/**
	 * The frame loop is the only clock. This card wants the passenger's own
	 * local time -- the Pi is in the room with them, so `toLocaleTimeString`
	 * stays -- but it does not need a second `setInterval` to learn what second
	 * it is: `display.view.wallSec` is the timestamp the current frame was
	 * derived from, and it advances every frame whether the blind is up or down.
	 */
	const now = $derived(new Date(display.view.wallSec * 1000));

	const timeStr = $derived(
		now.toLocaleTimeString('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		})
	);

	const destName = $derived(display.config.place.name.toUpperCase());
</script>

<div class="blind-info" aria-hidden="true">
	<span class="time">{timeStr}</span>
	<span class="destination">{destName}</span>
	<span class="coordinates">
		{display.config.place.lat.toFixed(1)}°N {display.config.place.lon.toFixed(1)}°E
	</span>
</div>

<style>
	.blind-info {
		position: absolute;
		top: 48%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		text-align: center;
		pointer-events: none;
		user-select: none;
		z-index: 10;
		padding: 0 1rem;
	}

	.time {
		font-weight: 300;
		font-size: 2.8rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		color: rgba(40, 45, 55, 0.26);
		letter-spacing: 0.02em;
		line-height: 1;
	}

	.destination {
		font-size: 1rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		color: rgba(40, 45, 55, 0.22);
		text-transform: uppercase;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.coordinates {
		font-size: 0.75rem;
		font-weight: 400;
		letter-spacing: 0.08em;
		color: rgba(40, 45, 55, 0.18);
		font-family: monospace;
	}
</style>
