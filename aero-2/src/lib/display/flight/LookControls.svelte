<script lang="ts">
	/**
	 * LookControls — on-screen arrows for aiming the window.
	 *
	 * These steer the SIMULATION, not the map. Panning the map directly
	 * (`map.panBy`) or binding pitch would be undone on the very next frame,
	 * because the frame loop re-derives the whole camera from the flight pose.
	 * Changing the params the pose is computed FROM is the only thing that
	 * survives — and it is also what a fleet broadcast would carry. Writes go
	 * through `config.nudge`, the single gate.
	 */
	import { CustomControl } from 'svelte-maplibre-gl';
	import { useDisplay } from '../display.svelte.js';

	const display = useDisplay();

	const pan = (deg: number) => display.config.nudge('azimuthDeg', deg);
	const look = (deg: number) => display.config.nudge('pitchDeg', deg);
</script>

<CustomControl position="bottom-right" class="look-controls">
	<button type="button" onclick={() => look(5)} aria-label="Show more sky">▲</button>
	<div class="row">
		<button type="button" onclick={() => pan(-15)} aria-label="Pan left">◀</button>
		<button type="button" onclick={() => pan(15)} aria-label="Pan right">▶</button>
	</div>
	<button type="button" onclick={() => look(-5)} aria-label="Show more ground">▼</button>
</CustomControl>

<style>
	:global(.look-controls) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		margin: 0 16px 16px 0;
	}
	:global(.look-controls) .row {
		display: flex;
		gap: 40px;
	}
	:global(.look-controls) button {
		width: 40px;
		height: 40px;
		border: 1px solid var(--glass-border);
		border-radius: 50%;
		background: var(--glass-bg);
		backdrop-filter: blur(var(--glass-blur));
		-webkit-backdrop-filter: blur(var(--glass-blur));
		color: var(--text-primary);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: var(--glass-shadow);
		transition:
			background 0.15s ease,
			transform 0.1s ease;
	}
	:global(.look-controls) button:hover {
		background: var(--glass-bg-hover);
		transform: scale(1.05);
	}
</style>
