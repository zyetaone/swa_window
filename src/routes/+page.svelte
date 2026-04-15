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
	import { createAppState } from "$lib/app-state.svelte";
	import { AIRCRAFT } from "$lib/constants";
	import { LOCATION_MAP } from "$lib/locations";
	import type { LocationId } from "$lib/types";
	import { savePersistedState } from "$lib/persistence";
	import { createWsClient } from "$lib/fleet/client.svelte";
	import { hydrateFromServer } from "$lib/scene/bundle/client";
	import { bundleStore } from "$lib/scene/bundle/store.svelte";
	import {
		startRemotePoll,
		resolveDeviceId,
		type ContentBundle,
		type ConfigPatch,
	} from "$lib/scene/bundle/remote";
	import Window from "$lib/chrome/Window.svelte";
	import Controls from "$lib/chrome/HUD.svelte";
	import SidePanel from "$lib/chrome/SidePanel.svelte";
	import TelemetryPanel from "$lib/chrome/TelemetryPanel.svelte";

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

	// Fleet server connection — receives admin push (location, weather, config).
	// createWsClient reads ?server= URL param or VITE_FLEET_SERVER env internally,
	// falls back to ws://hostname:3001. Always connects so the Pi registers
	// with the fleet server even if Cesium/WebGL fails downstream.
	$effect(() => {
		if (typeof window === "undefined") return;
		const client = createWsClient(model);
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

	// Pull any bundles the server has persisted to disk. Silent-fail if the
	// endpoint is unreachable — stock effects always render regardless.
	onMount(() => {
		void hydrateFromServer();
	});

	// Phase 5.7 — Cloudflare Push Worker poll (over-the-internet bundle/config push).
	// Opt-in via VITE_PUSH_WORKER_URL. Silent no-op if unset.
	//   onBundles: install each into bundleStore — picked up reactively by the compositor.
	//   onConfigs: feed each { path, value } through model.applyConfigPatch (RootConfig path-targeted).
	$effect(() => {
		if (typeof window === "undefined") return;
		const url = import.meta.env.VITE_PUSH_WORKER_URL;
		if (!url) return;
		const handle = startRemotePoll({
			deviceId: resolveDeviceId(),
			pushWorkerUrl: url,
			onBundles: (bundles: ContentBundle[]) => {
				for (const bundle of bundles) bundleStore.install(bundle);
			},
			onConfigs: (patches: ConfigPatch[]) => {
				for (const { path, value } of patches) {
					model.applyConfigPatch(path, value);
				}
			},
		});
		return () => handle.stop();
	});

	// Clean up model timers on page teardown
	onDestroy(() => model.destroy());

	// "F" keyboard toggle for window frame (designer spec — Phase 5b).
	// Only captures when no other text-entry element has focus so we don't
	// fight the time slider / weather dropdown / SidePanel inputs.
	$effect(() => {
		if (typeof window === "undefined") return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "f" && e.key !== "F") return;
			const t = e.target as HTMLElement;
			if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
			model.config.chrome.windowFrame = !model.config.chrome.windowFrame;
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	// Apply per-device config from URL search params (?location=dubai&altitude=30000)
	if (typeof window !== "undefined") {
		const params = new URLSearchParams(window.location.search);

		const locationParam = params.get("location")?.toLowerCase() as
			| LocationId
			| undefined;
		if (locationParam && LOCATION_MAP.has(locationParam)) {
			model.setLocation(locationParam);
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

		// Phase 7 — multi-Pi parallax role. URL wins over localStorage wins
		// over 'solo' default. When URL param is set, persist it so the role
		// survives reload without the query string. Non-solo roles also auto-
		// hide the window frame since three oval frames tile poorly.
		const ROLE_KEY = "aero.device.role";
		const roleParam = params.get("role")?.toLowerCase();
		const VALID_ROLES = ["solo", "left", "center", "right"] as const;
		type Role = (typeof VALID_ROLES)[number];
		const validRole = (r: string | null | undefined): r is Role =>
			typeof r === "string" && (VALID_ROLES as readonly string[]).includes(r);

		const fromUrl = validRole(roleParam) ? roleParam : null;
		const fromStorage = validRole(localStorage.getItem(ROLE_KEY))
			? (localStorage.getItem(ROLE_KEY) as Role)
			: null;
		const chosenRole: Role = fromUrl ?? fromStorage ?? "solo";

		if (chosenRole !== "solo") {
			model.config.camera.setRole(chosenRole);
			model.config.chrome.windowFrame = false;
		}
		if (fromUrl) {
			localStorage.setItem(ROLE_KEY, fromUrl);
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

<main class="app" class:no-frame={!model.config.chrome.windowFrame}>
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

	<!-- Observability viewer (Shift+T to toggle) -->
	<TelemetryPanel />
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
	   chrome, so they keep running regardless of this preference. The old
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
	   When toggled off via config.chrome.windowFrame=false, the cabin wall,
	   texture, and rivets disappear so the Cesium canvas reads edge-to-edge.
	   Window.svelte handles its own inner chrome in the .no-frame scope. */
	.app.no-frame .cabin-wall {
		background: #000;
		box-shadow: none;
	}
	.app.no-frame :global(.cabin-texture),
	.app.no-frame :global(.cabin-details) {
		visibility: hidden;
	}
</style>
