<script lang="ts">
	/**
	 * BlindInfoCard — centered Sky Portal branding + time/location readout.
	 * Shown when the blind is CLOSED (blind covers the scene).
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { formatTime } from '$lib/utils';

	const model = useAeroWindow();
</script>

<div class="blind-info">
	<div class="branding">
		<h1>Sky Portal</h1>
	</div>
	<div class="status-row">
		<span class="time">{formatTime(model.localTimeOfDay)}</span>
		<span class="menu-location">{model.currentLocation.name}</span>
	</div>
	<div class="hint">Double-tap to Open Window</div>
</div>

<style>
	.blind-info {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: rgba(40, 40, 50, 0.85);
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
		text-align: center;
		pointer-events: none;
		z-index: 200;
	}
	.branding { margin-bottom: 2rem; }
	h1 {
		margin: 0;
		font-size: 2.5rem;
		font-weight: 700;
		background: linear-gradient(135deg, var(--sw-blue) 0%, #1a2a6c 100%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		letter-spacing: -0.02em;
	}
	.status-row {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.time {
		font-weight: 300;
		font-size: 3.5rem;
		font-family: 'JetBrains Mono', 'Ubuntu', monospace;
	}
	.menu-location {
		font-size: 1.5rem;
		color: rgba(40, 40, 50, 0.6);
	}
	.hint {
		font-size: 0.8rem;
		color: rgba(48, 76, 178, 0.55);
		letter-spacing: 0.2em;
		text-transform: uppercase;
		margin-top: 1rem;
	}
</style>
