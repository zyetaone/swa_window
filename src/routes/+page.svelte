<script lang="ts">
	/**
	 * Aero Dynamic Window - Main Page
	 *
	 * Immersive airplane window experience with:
	 * - Real terrain and buildings (Cesium)
	 * - Wing, clouds, weather (Three.js)
	 * - Flight simulation (moving view)
	 * - Cabin interior context
	 */

	import { onMount } from "svelte";
	import { createViewerState } from "$lib/core/state.svelte";
	import { getFlightSimulation } from "$lib/core/FlightSimulation.svelte";
	import Window from "$lib/layers/Window.svelte";
	import Controls from "$lib/layers/Controls.svelte";

	// Create the viewer state (provides context to all child components)
	const viewerState = createViewerState();
	const flight = getFlightSimulation();

	// Auto-start flight simulation with proper cleanup
	onMount(() => {
		// Start gentle drift motion after a brief delay
		const startTimeout = setTimeout(() => {
			flight.start();
		}, 2000);

		return () => {
			clearTimeout(startTimeout);
			flight.stop();
		};
	});
</script>

<svelte:head>
	<title>Aero Dynamic Window</title>
</svelte:head>

<main class="app">
	<!-- Cabin wall with texture -->
	<div class="cabin-wall">
		<!-- Panel lines texture -->
		<div class="cabin-texture"></div>

		<!-- The window -->
		<Window />

		<!-- Rivets/details around window -->
		<div class="cabin-details">
			<div class="rivet rivet-tl"></div>
			<div class="rivet rivet-tr"></div>
			<div class="rivet rivet-bl"></div>
			<div class="rivet rivet-br"></div>
		</div>
	</div>

	<!-- Flight status indicator -->
	<div class="flight-status" class:active={flight.isRunning}>
		<span class="status-dot"></span>
		<span class="status-text">
			{flight.isRunning ? `Flying ${flight.groundSpeed} kts` : "Paused"}
		</span>
		<button class="flight-toggle" onclick={() => flight.toggle()}>
			{flight.isRunning ? "⏸" : "▶"}
		</button>
	</div>

	<!-- Controls Panel -->
	<Controls />
</main>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}

	.app {
		width: 100vw;
		height: 100vh;
		background: #2a2a2a;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.cabin-wall {
		position: relative;
		width: 100%;
		height: 100%;
		max-width: 1920px;
		max-height: 1080px;
		/* Cabin wall color - warm gray plastic */
		background: linear-gradient(
			180deg,
			#d8d5d0 0%,
			#e0ddd8 20%,
			#e5e2dd 50%,
			#e0ddd8 80%,
			#d5d2cd 100%
		);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow:
			inset 0 0 100px rgba(0, 0, 0, 0.1),
			0 0 50px rgba(0, 0, 0, 0.3);
	}

	.cabin-texture {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background:
			/* Horizontal panel seams */
			repeating-linear-gradient(
				0deg,
				transparent 0px,
				transparent 150px,
				rgba(0, 0, 0, 0.03) 150px,
				rgba(0, 0, 0, 0.03) 152px,
				transparent 152px
			),
			/* Vertical panel seams */
				repeating-linear-gradient(
					90deg,
					transparent 0px,
					transparent 200px,
					rgba(0, 0, 0, 0.02) 200px,
					rgba(0, 0, 0, 0.02) 202px,
					transparent 202px
				),
			/* Subtle noise texture */
				url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
	}

	.cabin-details {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.rivet {
		position: absolute;
		width: 6px;
		height: 6px;
		background: radial-gradient(circle at 30% 30%, #e5e5e5, #a0a0a0);
		border-radius: 50%;
		box-shadow:
			inset 0 1px 2px rgba(255, 255, 255, 0.5),
			0 1px 2px rgba(0, 0, 0, 0.3);
	}

	.rivet-tl {
		top: 15%;
		left: 20%;
	}
	.rivet-tr {
		top: 15%;
		right: 20%;
	}
	.rivet-bl {
		bottom: 15%;
		left: 20%;
	}
	.rivet-br {
		bottom: 15%;
		right: 20%;
	}

	.flight-status {
		position: fixed;
		bottom: 1rem;
		left: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(0, 0, 0, 0.8);
		color: white;
		padding: 0.5rem 1rem;
		border-radius: 20px;
		font-size: 0.8rem;
		z-index: 100;
		backdrop-filter: blur(5px);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		background: #666;
		border-radius: 50%;
		transition: background 0.3s;
	}

	.flight-status.active .status-dot {
		background: #4ade80;
		box-shadow: 0 0 8px #4ade80;
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.status-text {
		min-width: 100px;
	}

	.flight-toggle {
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.2);
		color: white;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		transition: all 0.2s;
	}

	.flight-toggle:hover {
		background: rgba(255, 255, 255, 0.2);
	}
</style>
