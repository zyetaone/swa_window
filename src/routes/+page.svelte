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

	import { onDestroy, onMount } from "svelte";
	import { createAeroWindow } from "$lib/model/aero-window.svelte";
	import { isValidLocation } from "$content/locations";
	import { isValidWeather } from "$lib/types";
	import { isValidDeviceRole, type DeviceRole } from "$lib/types";
	import { savePersistedState } from "$lib/model/persistence";
	import { createDeviceClient } from "$lib/fleet/client.svelte";
		import {
		hydrateFromServer,
		startRemotePoll,
		resolveDeviceId,
		type ContentBundle,
		type ConfigPatch,
	} from "$lib/scene/bundle/remote";
	import BootLockup from "$lib/shell/BootLockup.svelte";
	import Pane from "$lib/shell/Pane.svelte";
	import Controls from "$lib/shell/HUD.svelte";
	import SidePanel from "$lib/shell/SidePanel.svelte";
	import TelemetryPanel from "$lib/shell/TelemetryPanel.svelte";
	import { setParallaxRole } from "$lib/model/config-tree.svelte";
	// Composed panel sections — page picks the set + order it wants.
	import LocationPicker from "$lib/shell/panel/LocationPicker.svelte";
	import TimeControl from "$lib/shell/panel/TimeControl.svelte";
	import FlightControls from "$lib/shell/panel/FlightControls.svelte";
	import AtmosphereControls from "$lib/shell/panel/AtmosphereControls.svelte";
	import LightingControls from "$lib/shell/panel/LightingControls.svelte";
	import WeatherPicker from "$lib/shell/panel/WeatherPicker.svelte";
	import LabControls from "$lib/shell/panel/LabControls.svelte";
	import NightVariantPanel from "$lib/shell/panel/NightVariantPanel.svelte";

	// Create unified app state (provides context to all child components)
	// All state is reactive via $state/$derived in AeroWindow
	const model = createAeroWindow();

	// Lab mode (?lab=1, DEV only) — see the param parsing in onMount.
	let labMode = $state(false);
	let labRenderer = $state<'cesium' | 'hybrid' | 'night-lab'>('cesium');

	// The renderer selector is the ONLY lab writer of useThreeOverlay, and it
	// writes nothing unless lab mode is on — otherwise it would clobber the
	// config-tree default (and any ?overlay= / fleet config_patch) on the ship
	// route. Night Lab needs the overlay: variants E/F render through Three.
	$effect(() => {
		if (!labMode) return;
		model.applyConfigPatch('world.useThreeOverlay', labRenderer !== 'cesium');
	});

	$effect(() => {
		if (model.syncToRealTime && typeof window !== "undefined") {
			const update = () => model.updateTimeFromSystem();
			const interval = setInterval(
				update,
				model.config.director.daylight.syncIntervalMs,
			);
			return () => clearInterval(interval);
		}
		return undefined;
	});

	// Debounced auto-save (moved out of AeroWindow for testability).
	// `getPersistedSnapshot()` reads `flight.altitude`, which the cruise
	// engine writes on EVERY tick. Without a structural-change guard the
	// $effect re-ran 60×/sec, scheduling + cancelling a setTimeout each
	// frame (no leak, but constant microtask + GC churn). Hash the
	// snapshot and skip when nothing meaningful changed.
	let _lastSnapHash = '';
	$effect(() => {
		const data = model.getPersistedSnapshot();
		// Round altitude to 100 ft — sub-100 ft cruise jitter shouldn't
		// trigger a re-save. Other fields are categorical/booleans.
		const hash = `${data.location}|${Math.round(data.altitude / 100)}|${data.weather}|${data.cloudDensity}|${data.buildingsEnabled}|${data.showClouds}|${data.syncToRealTime}`;
		if (hash === _lastSnapHash) return;
		_lastSnapHash = hash;
		const timeout = setTimeout(() => savePersistedState(data), 2000);
		return () => clearTimeout(timeout);
	});

	// Fleet connection — SSE subscriber to own server's /api/events + peer
	// broadcast fan-out for Phase 7 leader→follower director_decision.
	// Always connects so the Pi is discoverable and responsive to admin
	// PATCHes even if Cesium/WebGL fails downstream.
	// onMount, not $effect: no reactive deps, runs once per page lifecycle.
	onMount(() => {
		const client = createDeviceClient(model);
		// Phase 7 — register the leader-broadcast hook so the director can
		// emit director_decision messages when this device is a panorama
		// leader. Solo devices set the hook too; it's harmless (nobody
		// receives the emits unless a group is configured server-side).
		model.setFleetBroadcast((msg) => client.publishV2(msg));
		return () => {
			model.setFleetBroadcast(null);
			client.destroy();
		};
	});

	
	// Clean up model timers on page teardown
	onDestroy(() => model.destroy());

	// "F" keyboard toggle for window frame (designer spec — Phase 5b).
	// Only captures when no other text-entry element has focus so we don't
	// fight the time slider / weather dropdown / SidePanel inputs.
	// Handler used by <svelte:window onkeydown> below — idiomatic over
	// addEventListener inside $effect per Svelte 5 best practices.
	function handleKey(e: KeyboardEvent) {
		if (e.key !== "f" && e.key !== "F") return;
		const t = e.target as HTMLElement;
		if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
		model.applyConfigPatch('shell.windowFrame', !model.config.shell.windowFrame);
	}

	// Global error capture (production hardening) — uncaught throws and
	// unhandled rejections land in the telemetry ring, which the fleet
	// heartbeat summarises to /api/status → visible on the admin health page
	// WITHOUT SSH. Audience never sees anything (council: never break the
	// fiction). Wired via <svelte:window> below per Svelte 5 best practices.
	function handleGlobalError(e: Event) {
		// svelte:window types onerror generically; the global error event IS
		// an ErrorEvent — narrow to read message/filename (resource-load
		// errors arrive as plain Events; still worth counting).
		const ee = e instanceof ErrorEvent ? e : null;
		model.telemetry.recordEvent("error", {
			where: "window.onerror",
			message: String(ee?.message ?? "resource error").slice(0, 200),
			source: ee ? `${ee.filename ?? ""}:${ee.lineno ?? 0}` : "",
		});
	}
	function handleUnhandledRejection(e: PromiseRejectionEvent) {
		const r = e.reason;
		model.telemetry.recordEvent("error", {
			where: "unhandledrejection",
			message: (r instanceof Error ? r.message : String(r)).slice(0, 200),
		});
	}

	// Apply per-device config from URL search params (?location=dubai&altitude=30000)
	if (typeof window !== "undefined") {
		const params = new URLSearchParams(window.location.search);

		const locationParam = params.get("location")?.toLowerCase();
		if (isValidLocation(locationParam)) {
			model.setLocation(locationParam);
		}

		// setAltitude clamps to camera.altitude.min/max downstream — the old
		// range check here silently DROPPED out-of-range values instead
		// (?altitude=3000 was ignored, min is 10000), which reads as "param
		// broken" during perf/visual A/Bs. Clamp-at-bound is the slider's
		// semantics; match it.
		const altitudeParam = params.get("altitude");
		if (altitudeParam) {
			const alt = Number(altitudeParam);
			if (Number.isFinite(alt)) model.setAltitude(alt);
		}

		// Pin time-of-day via ?time=2 (decimal hours 0-24) for a reproducible
		// scenario — disables real-time sync so the wall-clock can't override it.
		// Pairs with ?overlay for a fixed "Hyderabad night" A/B (perf gate + visual
		// comparison) instead of whatever hour it happens to be at the kiosk.
		const timeParam = params.get("time");
		if (timeParam !== null && timeParam !== "") {
			const t = Number(timeParam);
			if (Number.isFinite(t) && t >= 0 && t <= 24) {
				model.syncToRealTime = false;
				model.setTime(t);
			}
		}

		// Pin weather via ?weather=clear — completes the reproducible-scenario
		// trio with ?time + ?overlay so the perf/visual A/B isn't at the mercy
		// of whatever the director randomised at boot.
		const weatherParam = params.get("weather")?.toLowerCase();
		if (isValidWeather(weatherParam)) {
			model.setWeather(weatherParam);
		}

		// Perf-gate A/B (P8): force the hybrid Three overlay ON/OFF on the SHIP
		// route via ?overlay=1 / ?overlay=0, so the Pi-5 benchmark can measure the
		// exact shipping tree BOTH ways from one URL each (the go/no-go is the
		// delta). No param leaves the config-tree default (now true) untouched.
		// ?overlay=0 is therefore the per-Pi escape hatch on a device that can't
		// hold framerate — it does NOT persist across reboot (not in PersistedState),
		// so a struggling Pi needs it baked into the kiosk unit's URL.
		const overlayParam = params.get("overlay");
		if (overlayParam === "1" || overlayParam === "true") {
			model.applyConfigPatch('world.useThreeOverlay', true);
		} else if (overlayParam === "0" || overlayParam === "false") {
			model.applyConfigPatch('world.useThreeOverlay', false);
		}

		// Phase 7 — multi-Pi parallax role. URL wins over localStorage wins
		// over 'solo' default. When URL param is set, persist it so the role
		// survives reload without the query string. Non-solo roles also auto-
		// hide the window frame since three oval frames tile poorly.
		const ROLE_KEY = "aero.device.role";
		const roleParam = params.get("role")?.toLowerCase();

		const fromUrl = isValidDeviceRole(roleParam) ? roleParam : null;
		const stored = localStorage.getItem(ROLE_KEY);
		const fromStorage = isValidDeviceRole(stored) ? stored : null;
		const chosenRole: DeviceRole = fromUrl ?? fromStorage ?? "solo";

		if (chosenRole !== "solo") {
			model.applyConfigPatch('camera.parallax.role', chosenRole);
			setParallaxRole(chosenRole);
			model.applyConfigPatch('shell.windowFrame', false);
		}
		if (fromUrl) {
			localStorage.setItem(ROLE_KEY, fromUrl);
		}


		// Hash palette A/B: ?hashpalette=0 disables the production night look
		// to compare against aero-color-grade. ?hashpalette=1 re-enables it.
		const hpParam = params.get('hashpalette');
		if (hpParam === '1' || hpParam === 'true') {
			model.applyConfigPatch('world.useHashPalette', true);
		} else if (hpParam === '0' || hpParam === 'false') {
			model.applyConfigPatch('world.useHashPalette', false);
		}

		// Lab mode: ?lab=1 replaces the deleted /playground routes. The renderer
		// selector, wing tuner and night-variant harness now live in the ship
		// route's own SidePanel rather than a parallel page, so what gets tuned
		// is by construction what gets shipped. DEV-only — the {#if} below is
		// statically false in a production build, so nothing here reaches the Pi.
		const labParam = params.get('lab');
		const isLab = import.meta.env.DEV && (labParam === '1' || labParam === 'true');
		if (isLab) {
			labRenderer = model.config.world.useThreeOverlay ? 'hybrid' : 'cesium';
		}
		labMode = isLab;
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

<svelte:window
	onkeydown={handleKey}
	onerror={handleGlobalError}
	onunhandledrejection={handleUnhandledRejection}
/>

<main class={["app", !model.config.shell.windowFrame && "no-frame"]}>
	<!-- Cabin wall with texture -->
	<div class="cabin-wall">
		<!-- Panel lines texture -->
		<div class="cabin-texture"></div>

		<Pane />

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
	<SidePanel>
		<LocationPicker />
		<div class="divider"></div>
		<TimeControl />
		<div class="divider"></div>
		<FlightControls />
		<div class="divider"></div>
		<AtmosphereControls />
		<div class="divider"></div>
		<LightingControls />
		<div class="divider"></div>
		<WeatherPicker />
		{#if import.meta.env.DEV && labMode}
			<div class="divider"></div>
			<LabControls bind:mode={labRenderer} {model} />
		{/if}
	</SidePanel>

	<!-- Night-variant harness — its own floating <aside>, so it sits beside the
	     SidePanel rather than inside it. -->
	{#if import.meta.env.DEV && labMode && labRenderer === 'night-lab'}
		<NightVariantPanel {model} />
	{/if}

	<!-- Observability viewer (Shift+T to toggle) -->
	<TelemetryPanel />

	<!-- Held first frame — same artwork as the Plymouth theme and X root
	     window, dissolving once the renderer reports real frames. Last child
	     so it covers the shell without the shell needing to know about it. -->
	<BootLockup />
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
		/* Premium cabin wall — cool pearl white with subtle blue warmth */
		background:
			radial-gradient(ellipse at 50% 0%, rgba(48, 76, 178, 0.04) 0%, transparent 60%),
			linear-gradient(
				180deg,
				#eceef2 0%,
				#f0f2f5 15%,
				#f4f5f8 50%,
				#f0f2f5 85%,
				#e8eaee 100%
			);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow:
			inset 0 0 120px rgba(48, 76, 178, 0.04),
			inset 0 -2px 0 rgba(48, 76, 178, 0.08),
			0 0 60px rgba(0, 0, 0, 0.25);
	}

	.cabin-texture {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background:
			/* Fine horizontal panel seams */
			repeating-linear-gradient(
				0deg,
				transparent 0px,
				transparent 180px,
				rgba(48, 76, 178, 0.025) 180px,
				rgba(48, 76, 178, 0.025) 181px,
				transparent 181px
			),
			/* Vertical panel seams */
			repeating-linear-gradient(
				90deg,
				transparent 0px,
				transparent 240px,
				rgba(0, 0, 0, 0.015) 240px,
				rgba(0, 0, 0, 0.015) 241px,
				transparent 241px
			);
	}

	.cabin-details {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.rivet {
		position: absolute;
		width: 7px;
		height: 7px;
		background: radial-gradient(circle at 35% 30%, rgba(255,255,255,0.9), rgba(48, 76, 178, 0.3) 60%, rgba(30, 55, 140, 0.6));
		border-radius: 50%;
		box-shadow:
			inset 0 1px 2px rgba(255, 255, 255, 0.8),
			0 1px 3px rgba(0, 0, 0, 0.25),
			0 0 0 1px rgba(48, 76, 178, 0.15);
	}

	.rivet-tl {
		top: 12%;
		left: 18%;
	}
	.rivet-tr {
		top: 12%;
		right: 18%;
	}
	.rivet-bl {
		bottom: 12%;
		left: 18%;
	}
	.rivet-br {
		bottom: 12%;
		right: 18%;
	}

	/* Kiosk-only: hide cursor everywhere when html has the .kiosk class
	   (set by app.html based on hostname=localhost). Dev/admin reaching the
	   Pi via its LAN hostname or IP keeps a normal pointer for interaction. */
	:global(html.kiosk),
	:global(html.kiosk *),
	:global(html.kiosk *:hover) {
		cursor: none !important;
	}

	/* Accessibility: focus indicators */
	:global(:focus-visible) {
		outline: 2px solid var(--sw-yellow);
		outline-offset: 2px;
	}

	/* Accessibility: reduce motion for DECORATIVE hint animations only.
	   Scene animations (cloud drift, warp, breathing) are the product, not
	   shell, so they keep running regardless of this preference. The old
	   blanket :global(*) rule silently froze the cloud deck on any OS with
	   reduce-motion enabled. */
	@media (prefers-reduced-motion: reduce) {
		:global(.click-hint),
		:global(.blind-overlay.discoverable::after) {
			animation: none !important;
		}
		:global(.blind-overlay) {
			transition-duration: 0.01ms !important;
		}
	}

	/* Window-frame on/off (Phase 5b).
	   When toggled off via config.shell.windowFrame=false, the cabin wall,
	   texture, and rivets disappear so the Cesium canvas reads edge-to-edge.
	   Pane.svelte handles its own inner shell in the .no-frame scope. */
	.app.no-frame .cabin-wall {
		background: #000;
		box-shadow: none;
	}
	.app.no-frame :global(.cabin-texture),
	.app.no-frame :global(.cabin-details) {
		visibility: hidden;
	}
</style>
