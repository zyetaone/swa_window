<script lang="ts">
	/**
	 * TelemetryOverlay — cinematic top-right ALT / GS / LOC readout.
	 * Shown when the blind is OPEN (scene visible).
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { formatTime } from '$lib/utils';

	const model = useAeroWindow();
	const locationName = $derived(model.currentLocation.name);
	const destName     = $derived(model.flight.cruiseDestinationName ?? '');
	const isCruising   = $derived(model.flight.flightMode !== 'orbit');
</script>

<div class="hud-wrapper">
	<div class="hud-layer">
		<div class="status-group">
			<div class="primary-stat">
				<span class="hud-location">{isCruising ? destName : locationName}</span>
				<span class={['mode-badge', isCruising && 'cruising']}>
					{isCruising ? 'CRUISE' : 'ORBIT'}
				</span>
			</div>
			<div class="telemetry-grid">
				<div class="stat">
					<span class="label">ALT</span>
					<span class="value">{(model.flight.altitude / 1000).toFixed(1)}<small>k ft</small></span>
				</div>
				<div class="stat">
					<span class="label">GS</span>
					<span class="value">{model.flight.flightSpeed.toFixed(1)}<small>x</small></span>
				</div>
				<div class="stat">
					<span class="label">LOC</span>
					<span class="value">{formatTime(model.localTimeOfDay)}</span>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.hud-wrapper {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.hud-layer {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		padding: clamp(1rem, 4vmin, 3rem);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		background: radial-gradient(ellipse at top right, rgba(0, 0, 0, 0.35) 0%, transparent 70%);
	}
	.status-group {
		align-self: flex-end;
		text-align: right;
		color: rgba(255, 255, 255, 0.85);
		text-shadow: 0 1px 6px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 0, 0, 0.3);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.primary-stat {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}
	.hud-location {
		font-size: 1.2rem;
		font-weight: 300;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		font-family: 'Ubuntu', system-ui, sans-serif;
	}
	.mode-badge {
		font-size: 0.6rem;
		font-weight: 500;
		padding: 0.1rem 0.4rem;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 2px;
		letter-spacing: 0.15em;
		backdrop-filter: blur(2px);
		color: rgba(255, 255, 255, 0.7);
	}
	.mode-badge.cruising {
		border-color: rgba(48, 76, 178, 0.4);
		color: rgba(48, 76, 178, 0.85);
		box-shadow: 0 0 10px rgba(48, 76, 178, 0.15);
	}
	.telemetry-grid {
		display: flex;
		gap: 2rem;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}
	.stat {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}
	.label {
		font-size: 0.625rem;
		opacity: 0.5;
		letter-spacing: 0.2em;
		font-weight: 400;
		margin-bottom: 0.1rem;
	}
	.value {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.8rem;
		font-weight: 400;
		letter-spacing: 0.05em;
		opacity: 0.9;
	}
	small {
		font-size: 0.7em;
		opacity: 0.6;
		margin-left: 0.2em;
	}
</style>
