<script lang="ts">
	/**
	 * PassengerHud — elegant passenger in-flight status display.
	 */
	import { useAeroWindow } from '#lib/sim/aero-window.svelte.js';

	const windowState = useAeroWindow();

	function formatTime(h: number): string {
		const hours = Math.floor(h);
		const mins = Math.floor((h - hours) * 60);
		return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
	}
</script>

{#if windowState.hudVisible}
	<header class="passenger-hud" aria-label="Flight status">
		<div class="destination-card">
			<span class="destination-prefix">APPROACHING</span>
			<h1 class="destination-name">{windowState.params.place.id.toUpperCase()}</h1>
		</div>

		<div class="telemetry-badges">
			<div class="badge">
				<span class="badge-label">ALT</span>
				<span class="badge-value">{Math.round(windowState.view.aglM)} m</span>
			</div>
			<div class="badge">
				<span class="badge-label">TIME</span>
				<span class="badge-value">{formatTime(windowState.view.timeOfDay)}</span>
			</div>
		</div>
	</header>
{/if}

<style>
	.passenger-hud {
		position: fixed;
		top: 1.5rem;
		left: 2rem;
		right: 2rem;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		pointer-events: none;
		z-index: 15;
		color: #fff;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.destination-card {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
	}

	.destination-prefix {
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.18em;
		color: rgba(255, 255, 255, 0.6);
	}

	.destination-name {
		font-size: 1.35rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		margin: 0;
		text-transform: uppercase;
	}

	.telemetry-badges {
		display: flex;
		gap: 0.75rem;
	}

	.badge {
		background: rgba(15, 20, 28, 0.45);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 8px;
		padding: 0.35rem 0.65rem;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.1rem;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
	}

	.badge-label {
		font-size: 0.55rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: rgba(255, 255, 255, 0.5);
	}

	.badge-value {
		font-size: 0.85rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: rgba(255, 255, 255, 0.95);
	}
</style>
