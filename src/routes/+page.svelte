<script lang="ts">
	/**
	 * Aero Dynamic Window - Main Page
	 *
	 * Circadian-aware airplane window display with:
	 * - Real terrain and buildings (Cesium)
	 * - CSS effect layers (clouds, weather, city lights)
	 * - Time-synced sky states
	 * - Cabin interior context
	 */

	import { createAppState, LOCATION_MAP, AIRCRAFT } from "$lib/core";
	import type { LocationId } from "$lib/core";
	import { savePersistedState } from "$lib/core/persistence";
	import Window from "$lib/layers/Window.svelte";
	import Controls from "$lib/layers/Controls.svelte";
	import SidePanel from "$lib/layers/SidePanel.svelte";

	// Create unified app state (provides context to all child components)
	// All state is reactive via $state/$derived in WindowModel
	const model = createAppState();

	// Real-time sync (moved out of WindowModel for testability)
	$effect(() => {
		if (model.syncToRealTime && typeof window !== "undefined") {
			const update = () => model.updateTimeFromSystem();
			const interval = setInterval(
				update,
				AIRCRAFT.REAL_TIME_SYNC_INTERVAL,
			);
			return () => clearInterval(interval);
		}
		return undefined;
	});

	// Debounced auto-save (moved out of WindowModel for testability)
	$effect(() => {
		const data = model.getPersistedSnapshot();
		const timeout = setTimeout(() => savePersistedState(data), 2000);
		return () => clearTimeout(timeout);
	});

	// Apply per-device config from URL search params (?location=dubai&altitude=30000)
	if (typeof window !== "undefined") {
		const params = new URLSearchParams(window.location.search);

		const locationParam = params.get("location")?.toLowerCase();
		if (locationParam && LOCATION_MAP.has(locationParam)) {
			model.setLocation(locationParam as LocationId);
		}

		const altitudeParam = params.get("altitude");
		if (altitudeParam) {
			const alt = Number(altitudeParam);
			if (
				Number.isFinite(alt) &&
				alt >= AIRCRAFT.MIN_ALTITUDE &&
				alt <= AIRCRAFT.MAX_ALTITUDE
			) {
				model.setAltitude(alt);
			}
		}
	}
</script>

<svelte:head>
	<title>Sky Portal</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link
		rel="preconnect"
		href="https://fonts.gstatic.com"
		crossorigin="anonymous"
	/>
	<link
		href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&family=JetBrains+Mono:wght@400;500&display=swap"
		rel="stylesheet"
	/>
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

	<!-- Controls (HUD + blind info) -->
	<Controls />

	<!-- Side panel (location picker + settings) -->
	<SidePanel />
</main>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: #000;

		/* SouthWest Airlines Branding */
		--sw-blue: #304cb2;
		--sw-red: #d5152e;
		--sw-yellow: #ffbf27;
		--sw-silver: #cccccc;
		--sw-dark-blue: #0a0a1e;

		font-family:
			"Ubuntu",
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
		max-width: 3840px;
		max-height: 2160px;
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

	/* Accessibility: focus indicators */
	:global(:focus-visible) {
		outline: 2px solid var(--sw-yellow);
		outline-offset: 2px;
	}

	/* Accessibility: reduced motion */
	@media (prefers-reduced-motion: reduce) {
		:global(*) {
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
			transition-duration: 0.01ms !important;
		}
	}
</style>
