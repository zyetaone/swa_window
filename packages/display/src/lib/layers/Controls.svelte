<script lang="ts">
	/**
	 * Controls.svelte - HUD Overlay & Blind Info
	 *
	 * State 1: Blind OPEN — minimal HUD (telemetry overlay)
	 * State 2: Blind CLOSED — time/location display on blind surface
	 *
	 * Location picker and settings are in SidePanel.svelte.
	 */

	import { useAppState } from "$lib/core";
	import { formatTime } from "$lib/core/utils";
	const model = useAppState();

	// HUD derived values
	const locationName = $derived(model.currentLocation.name);
	const destName = $derived(model.cruiseDestinationName ?? "");
	const isCruising = $derived(model.flightMode !== "orbit");

	// aria-live announcement for flight transitions
	let prevTransitioning = false; // plain JS — not reactive, just previous-frame tracking
	let liveAnnouncement = $state("");

	$effect(() => {
		const transitioning = model.isTransitioning;
		const destination = model.cruiseDestinationName;

		if (transitioning && destination && !prevTransitioning) {
			liveAnnouncement = `Flying to ${destination}`;
		} else if (!transitioning && prevTransitioning) {
			liveAnnouncement = `Arrived at ${model.currentLocation.name}`;
		}

		prevTransitioning = transitioning;
	});
</script>

<!-- Screen-reader announcement for flight transitions -->
<div class="sr-only" aria-live="polite" role="status">
	{liveAnnouncement}
</div>

{#if model.blindOpen}
	<!-- HUD: Cinematic telemetry overlay -->
	<div class="hud-wrapper">
		<div class="hud-layer">
			<div class="status-group">
				<div class="primary-stat">
					<span class="hud-location">{isCruising ? destName : locationName}</span>
					<span class="mode-badge" class:cruising={isCruising}>
						{isCruising ? "CRUISE" : "ORBIT"}
					</span>
				</div>

				<div class="telemetry-grid">
					<div class="stat">
						<span class="label">ALT</span>
						<span class="value"
							>{(model.altitude / 1000).toFixed(1)}<small>k ft</small></span
						>
					</div>
					<div class="stat">
						<span class="label">GS</span>
						<span class="value"
							>{model.flightSpeed.toFixed(1)}<small>x</small></span
						>
					</div>
					<div class="stat">
						<span class="label">LOC</span>
						<span class="value">{formatTime(model.localTimeOfDay)}</span>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if !model.blindOpen}
	{#if model.isTransitioning && model.cruiseOriginName && model.cruiseDestinationName}
		<!-- Flight route graphic during cruise transition -->
		<div class="blind-info flight-route">
			<div class="route-header">IN FLIGHT</div>
			<div class="route-graphic">
				<div class="route-city origin">
					<span class="city-dot"></span>
					<span class="city-name">{model.cruiseOriginName}</span>
				</div>
				<div class="route-line">
					<div class="route-dashes"></div>
					<div class="route-plane">&#9992;</div>
				</div>
				<div class="route-city destination">
					<span class="city-dot"></span>
					<span class="city-name">{model.cruiseDestinationName}</span>
				</div>
			</div>
			<div class="route-time">{formatTime(model.localTimeOfDay)}</div>
		</div>
	{:else}
		<div class="blind-info">
			<div class="branding">
				<h1>Sky Portal</h1>
			</div>
			<div class="status-row">
				<span class="time">{formatTime(model.localTimeOfDay)}</span>
				<span class="menu-location">{model.currentLocation.name}</span>
			</div>
			<div class="hint">Pull up to open</div>
		</div>
	{/if}
{/if}

<style>
	/* --- HUD (Cinematic Mode) --- */

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
		background: radial-gradient(
			ellipse 40% 30% at top right,
			rgba(0, 0, 0, 0.2) 0%,
			transparent 50%
		);
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
		font-weight: 400;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		font-family: "Ubuntu", system-ui, sans-serif;
	}

	.mode-badge {
		font-size: 0.7rem;
		font-weight: 500;
		padding: 0.1rem 0.4rem;
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 2px;
		letter-spacing: 0.15em;
		backdrop-filter: blur(2px);
		color: rgba(255, 255, 255, 0.9);
	}

	.mode-badge.cruising {
		border-color: rgba(48, 76, 178, 0.7);
		color: rgba(255, 255, 255, 0.95);
		background: rgba(48, 76, 178, 0.5);
		box-shadow: 0 0 10px rgba(48, 76, 178, 0.15);
	}

	.telemetry-grid {
		display: flex;
		gap: 1.25rem;
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
		font-family: "JetBrains Mono", "Fira Code", monospace;
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

	/* --- Blind Info (simplified — controls are in SidePanel) --- */

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

	.branding {
		margin-bottom: 2rem;
	}

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
		font-family: "Ubuntu", system-ui, sans-serif;
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

	/* --- Flight Route (blind closed + transitioning) --- */

	.flight-route {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
	}

	.route-header {
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: rgba(48, 76, 178, 0.6);
	}

	.route-graphic {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 80%;
		max-width: 280px;
	}

	.route-city {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.city-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: rgba(48, 76, 178, 0.7);
		box-shadow: 0 0 6px rgba(48, 76, 178, 0.3);
	}

	.city-name {
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: rgba(40, 40, 50, 0.75);
		white-space: nowrap;
	}

	.route-line {
		flex: 1;
		display: flex;
		align-items: center;
		position: relative;
		min-width: 60px;
	}

	.route-dashes {
		width: 100%;
		height: 2px;
		background: repeating-linear-gradient(
			90deg,
			rgba(48, 76, 178, 0.3) 0px,
			rgba(48, 76, 178, 0.3) 6px,
			transparent 6px,
			transparent 12px
		);
	}

	.route-plane {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		font-size: 1.3rem;
		color: rgba(48, 76, 178, 0.8);
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.15));
		animation: plane-pulse 2s ease-in-out infinite;
	}

	@keyframes plane-pulse {
		0%, 100% { opacity: 0.8; transform: translate(-50%, -50%) scale(1); }
		50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
	}

	.route-time {
		font-family: "JetBrains Mono", "Ubuntu", monospace;
		font-size: 1.8rem;
		font-weight: 300;
		color: rgba(40, 40, 50, 0.7);
	}

	/* --- Screen-reader only --- */

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}
</style>
