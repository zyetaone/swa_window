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
	import { createWsClient } from "$lib/core/ws-client";
	import { onDestroy } from "svelte";
	import Window from "$lib/layers/Window.svelte";
	import Controls from "$lib/layers/Controls.svelte";
	import SidePanel from "$lib/layers/SidePanel.svelte";

	// Create unified app state (provides context to all child components)
	// All state is reactive via $state/$derived in WindowModel
	const model = createAppState();
	onDestroy(() => model.destroy());

	// Connect to fleet management server (auto-registers this display)
	const wsClient = createWsClient(model);
	onDestroy(() => wsClient.destroy());

	// Register service worker for offline tile caching (kiosk resilience)
	if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
		navigator.serviceWorker.register('/sw.js').catch(() => {
			// SW registration failed — tiles will load from network only
		});
	}

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

	// Debounced auto-save — saves 2s after the last reactive change.
	// Touch reactive fields to subscribe, but defer snapshot+save to the timeout.
	$effect(() => {
		// Subscribe to persisted fields (triggers re-run on any change)
		void model.location;
		void model.altitude;
		void model.weather;
		void model.cloudDensity;
		void model.showBuildings;
		void model.showClouds;
		void model.syncToRealTime;
		const timeout = setTimeout(() => savePersistedState(model.getPersistedSnapshot()), 2000);
		return () => clearTimeout(timeout);
	});

	// Apply per-device config from URL search params (?location=dubai&altitude=30000)
	if (typeof window !== "undefined") {
		const params = new URLSearchParams(window.location.search);

		const locationParam = params.get("location")?.toLowerCase();
		if (locationParam && LOCATION_MAP.has(locationParam as LocationId)) {
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

		/* Spacing Scale */
		--space-1: 0.25rem;
		--space-2: 0.5rem;
		--space-3: 0.75rem;
		--space-4: 1rem;
		--space-5: 1.5rem;
		--space-6: 2rem;

		/* Type Scale */
		--text-xs: 0.625rem;
		--text-sm: 0.75rem;
		--text-base: 0.875rem;
		--text-md: 1rem;
		--text-lg: 1.25rem;
		--text-xl: 1.5rem;
		--text-2xl: 2.5rem;
		--text-3xl: 3.5rem;

		/* Surfaces */
		--surface-overlay: rgba(10, 10, 30, 0.88);
		--surface-card: rgba(255, 255, 255, 0.05);
		--surface-card-border: rgba(255, 255, 255, 0.08);
		--surface-button: rgba(255, 255, 255, 0.08);
		--surface-button-border: rgba(255, 255, 255, 0.12);
		--surface-button-hover: rgba(255, 255, 255, 0.15);
		--surface-button-active: rgba(48, 76, 178, 0.4);

		/* Text */
		--text-primary: rgba(255, 255, 255, 0.9);
		--text-secondary: rgba(255, 255, 255, 0.7);
		--text-muted: rgba(255, 255, 255, 0.5);
		--text-blind: rgba(40, 40, 50, 0.85);

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
				);
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
