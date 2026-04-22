<script lang="ts">
	/**
	 * Window - Layer compositor + game loop
	 *
	 * Owns the RAF tick loop (single game clock).
	 * Composes: Cesium (terrain) + CSS clouds + CSS effect overlays.
	 *
	 * Z-order:
	 *   0: Cesium (terrain, buildings, NASA night lights, CartoDB roads)
	 *   1: Clouds (CSS-only feTurbulence + feDisplacementMap via CloudBlobs)
	 *   2: Weather (CSS rain + lightning)
	 *   5: Frost
	 *   7: Wing silhouette
	 *   9: Glass vignette
	 *  10: Vignette
	 */
	import { untrack } from "svelte";
	import { useAeroWindow } from "$lib/model/aero-window.svelte";
	import { AIRCRAFT, FLIGHT_FEEL } from "$lib/constants";
	import { clamp } from "$lib/utils";
	import { subscribe } from "$lib/game-loop";
	import CesiumViewer from "$lib/world/CesiumViewer.svelte";
	import Glass from "./window/Glass.svelte";
	import Blind from "./window/Blind.svelte";
	import Weather from '$lib/atmosphere/weather/Weather.svelte';
	import Compositor from '$lib/scene/compositor.svelte';
	const model = useAeroWindow();

	// Window frame on/off (Phase 5b) — CSS visibility toggle. Blind still works
	// in both modes; frame bits (oval mask, rivets, glass, vignette, recess)
	// simply disappear when false.
	const frameVisible = $derived(model.config.shell.windowFrame);

	// ========================================================================
	// GAME LOOP — single RAF driving model.tick()
	// ========================================================================

	// Tick body wrapped in untrack() so 60 Hz reads of config/flight/weather
	// state inside model.tick() don't build a reactive dependency from this
	// effect back onto AeroWindow — otherwise any config change re-subscribes
	// the game loop, silently doubling tick frequency until the next subscribe.
	$effect(() =>
		subscribe((dt: number) => {
			untrack(() => {
				model.tick(dt);
				model.reportFrame();
			});
		}),
	);

	// ========================================================================
	// ACTIONS
	// ========================================================================

	function handleWindowClick() {
		if (model.flight.isTransitioning) return;
		const nextId = model.pickNextLocation();
		model.flight.flyTo(nextId);
	}

	// ─── Long-press → speed boost ────────────────────────────────────────────
	// Press + hold the window for >250ms to ramp speed 1.4x → 3.0x over 700ms.
	// Release returns to baseline over 500ms. Short tap still fires
	// handleWindowClick (fly-to next location).
	const BASE_SPEED = 1.4;        // matches config.camera.cruise.defaultSpeed
	const BOOST_SPEED = 3.0;
	const LONG_PRESS_MS = 250;
	const RAMP_UP_MS = 700;
	const RAMP_DOWN_MS = 500;

	// pressTimer + boostRampId are imperative handles (setTimeout/rAF),
	// never read in a template or derived — plain let avoids signal-graph bloat.
	let pressTimer: number | null = null;
	let boostRampId: number | null = null;
	let isBoosting = $state(false);

	function cancelBoostRamp() {
		if (boostRampId !== null) {
			cancelAnimationFrame(boostRampId);
			boostRampId = null;
		}
	}

	function rampSpeed(from: number, to: number, durationMs: number) {
		cancelBoostRamp();
		const t0 = performance.now();
		const step = (now: number) => {
			const t = clamp((now - t0) / durationMs, 0, 1);
			model.flight.flightSpeed = from + (to - from) * (t * t * (3 - 2 * t));
			if (t < 1) boostRampId = requestAnimationFrame(step);
			else boostRampId = null;
		};
		boostRampId = requestAnimationFrame(step);
	}

	function handlePointerDown() {
		if (model.flight.isTransitioning) return;
		pressTimer = window.setTimeout(() => {
			pressTimer = null;
			isBoosting = true;
			rampSpeed(model.flight.flightSpeed, BOOST_SPEED, RAMP_UP_MS);
		}, LONG_PRESS_MS);
	}

	function handlePointerUp() {
		if (pressTimer !== null) {
			// Short tap — fire the fly-to action, skip boost.
			clearTimeout(pressTimer);
			pressTimer = null;
			handleWindowClick();
			return;
		}
		if (isBoosting) {
			isBoosting = false;
			rampSpeed(model.flight.flightSpeed, BASE_SPEED, RAMP_DOWN_MS);
		}
	}

	function handlePointerCancel() {
		if (pressTimer !== null) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
		if (isBoosting) {
			isBoosting = false;
			rampSpeed(model.flight.flightSpeed, BASE_SPEED, RAMP_DOWN_MS);
		}
	}

	// ========================================================================
	// DERIVED — presentation values
	// ========================================================================

	const FROST_RANGE =
		AIRCRAFT.FROST_MAX_ALTITUDE - AIRCRAFT.FROST_START_ALTITUDE;

	// --- Sky ---

	const skyBackground = $derived.by(() => {
		switch (model.skyState) {
			case "night":
				return "linear-gradient(180deg, #0a0a1e 0%, #1a1a2e 50%, #0d0d20 100%)";
			case "dawn":
				return "linear-gradient(180deg, #1a1a3a 0%, #4a3060 30%, #d08060 70%, #e0a070 100%)";
			case "dusk":
				return "linear-gradient(180deg, #1a1a3a 0%, #503050 30%, #c07050 70%, #d09060 100%)";
			default:
				return "linear-gradient(180deg, #4a7ab5 0%, #6a9ad0 40%, #8cb8e0 70%, #a0c8e8 100%)";
		}
	});

	// --- Atmospheric effects ---

	const frostAmount = $derived(
		clamp(
			(model.flight.altitude - AIRCRAFT.FROST_START_ALTITUDE) / FROST_RANGE,
			0,
			1,
		),
	);

	const filterString = $derived.by(() => {
		const timeBrightness =
			model.skyState === "night"
				? 1.0
				: model.skyState === "dawn" || model.skyState === "dusk"
					? 0.95
					: 1.0;
		const hazeContrast = 1 - model.haze * 0.08;
		const hazeSaturate = 1 - model.haze * 0.1;
		const brightness = timeBrightness * model.config.atmosphere.weather.filterBrightness;
		const w = model.flight.warpFactor;
		const baseBlur = 0.35;
		const base = `brightness(${brightness.toFixed(2)}) contrast(${hazeContrast.toFixed(2)}) saturate(${hazeSaturate.toFixed(2)}) blur(${baseBlur}px)`;
		if (w < 0.01) return base;
		return `${base} blur(${(w * 5).toFixed(1)}px) brightness(${(1 + w * 0.3).toFixed(2)})`;
	});

	// --- Weather ---
	const rainOpacity = $derived(model.config.atmosphere.weather.rainOpacity);
	const windAngle = $derived(model.config.atmosphere.weather.windAngle);

	// --- Motion (unified from 4 independent layers) ---

	// Turbulence shakes the window (shell/frame) — but the translation is
	// kept light on the scene-content so it doesn't briefly cancel the
	// Cesium camera's forward motion and make the plane "appear to stop"
	// during bumps. Bank rotation and breathing still carry full effect.
	const turbulenceY = $derived(model.motion.motionOffsetY * 0.08);
	const turbulenceX = $derived(model.motion.motionOffsetX * 0.08);
	const turbulenceRotate = $derived(model.motion.motionOffsetY * 0.02);
	const breathingY = $derived(
		model.motion.breathingOffset * FLIGHT_FEEL.BREATHING_AMPLITUDE,
	);
	const bankDegrees = $derived(model.motion.bankAngle);

	const motionTransform = $derived.by(() => {
		const x = turbulenceX + model.motion.engineVibeX;
		const y = turbulenceY + breathingY + model.motion.engineVibeY;
		const rotate = turbulenceRotate + bankDegrees;
		return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rotate.toFixed(3)}deg)`;
	});


	// --- Wing silhouette (dark gradient at bottom-left, shifting with bank) ---

	const wingTransform = $derived(
		`rotate(${(-2 + model.motion.bankAngle * 0.3).toFixed(2)}deg)`,
	);

	// --- Glass ---

	const glassVignetteOpacity = $derived(
		model.skyState === "night" ? 0.3 : model.skyState === "day" ? 0.1 : 0.2,
	);

	// --- Timed click-hint (touch kiosks have no :hover) ---
	let showHint = $state(false);
	$effect(() => {
		if (model.blindOpen && !model.flight.isTransitioning) {
			const showTimer = setTimeout(() => { showHint = true; }, 3000);
			const hideTimer = setTimeout(() => { showHint = false; }, 8000);
			return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
		}
		showHint = false;
		return undefined;
	});

	// ========================================================================
	// BLIND LOGIC — see useBlind composable
	// ========================================================================

</script>

<div
	class={['window-container', !frameVisible && 'no-frame']}
	role="region"
	aria-roledescription="airplane window"
	aria-label="Window Viewport"
>
	<!-- The oval window. Click = fly somewhere new. Long-press = speed boost. -->
	<button
		class={['window-viewport', isBoosting && 'boosting']}
		onpointerdown={handlePointerDown}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerCancel}
		onpointerleave={handlePointerCancel}
		type="button"
		aria-label="Tap to fly somewhere new. Hold to speed up."
		style:background={skyBackground}
		disabled={model.flight.isTransitioning}
	>
		<!-- Scene content — shifts with turbulence/bank, clipped by the fixed viewport -->
		<div
			class="scene-content"
			style:transform={motionTransform}
			style:filter={filterString}
		>
			<!-- z:0 — Cesium terrain/buildings/city light billboards -->
			<div class="render-layer" style:z-index={0}>
				<CesiumViewer />
			</div>

			<!-- z:1-3 — Scene effects (clouds, lightning, micro-events) -->
			<Compositor />

			<!-- z:2 rain, z:5 frost -->
			<Weather {rainOpacity} {windAngle} {frostAmount} />

			<!-- z:7 — Wing silhouette (bottom-left, shifts with bank) -->
			<div
				class="wing-silhouette"
				style:z-index={7}
				style:transform={wingTransform}
			></div>
		</div>

		<!-- Fixed to glass (not affected by turbulence) — glass-surface +
		     vignette + recess rim, z:9–11. See shell/window/Glass.svelte. -->
		<Glass {glassVignetteOpacity} />

		<!-- UI overlays — timed reveal (no :hover on touch kiosks) -->
		{#if showHint}
			<div class="click-hint visible">
				<span>Tap to fly somewhere new</span>
			</div>
		{/if}
	</button>

	<!-- Blind — pull-down shade with slats + pull-tab + from→to chevrons.
	     Uses useBlind() composable internally; styles own their CSS. -->
	<Blind />
</div>

<style>
	.window-container {
		/* Shape tokens — shared by container, viewport, blind */
		--frame-width: 24px; /* Thicker, more substantial rim */
		--window-radius: 160px; /* Fixed stadium curvature */
		--inner-radius: 136px; /* 160px - 24px = 136px (Exact concentric fit) */

		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);

		/* Maximize size - Expansive View */
		height: 82vh; /* Primary size driver */
		width: auto; /* Derived from aspect */
		aspect-ratio: 2 / 3; /* Classic aircraft oval */
		max-width: 85vw; /* Mobile safety constraint */

		border-radius: var(--window-radius);
		overflow: hidden;
		z-index: 10;

		/* Metallic frame — visible in the gap between container and viewport */
		background: linear-gradient(
			135deg,
			#d8d8dd 0%,
			#b0b0b5 50%,
			#909098 100%
		);

		/* Deep embedded shadow - Symmetrical (No directional offsets) */
		box-shadow:
			inset 0 0 30px rgba(0, 0, 0, 0.6),
			/* Inner depth */ inset 0 0 4px rgba(0, 0, 0, 0.3),
			/* Sharp rim */ 0 0 40px rgba(0, 0, 0, 0.5); /* Outer wall drop shadow */
	}

	@media (orientation: portrait) {
		.window-container {
			width: 85vw;
			height: auto;
			max-height: 85vh;
		}
	}

	@media (orientation: landscape) {
		.window-container {
			height: 88vh;
			width: auto;
		}
	}

	.window-viewport {
		display: block;
		position: absolute;
		inset: var(--frame-width);
		border-radius: var(--inner-radius);
		overflow: hidden;
		border: none;
		padding: 0;
		cursor: pointer;

		transition: background 1s ease;
	}

	.window-viewport:disabled {
		cursor: not-allowed;
		opacity: 0.6;
		pointer-events: none;
	}

	/* Scene content — moves with turbulence, slightly oversized to prevent edge gaps */
	.scene-content {
		position: absolute;
		inset: -4px;
		will-change: transform;
	}

	.render-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.render-layer > :global(*) {
		position: absolute !important;
		inset: 0 !important;
		width: 100% !important;
		height: 100% !important;
	}

	/* Glass recess rim — on TOP of everything, creates the depth illusion */
	/* --- Wing silhouette --- */

	.wing-silhouette {
		position: absolute;
		bottom: -5%;
		left: -15%;
		width: 75%;
		height: 35%;
		pointer-events: none;
		transform-origin: 80% 100%;
		background: linear-gradient(
			25deg,
			rgba(20, 20, 25, 0.7) 0%,
			rgba(30, 30, 35, 0.5) 20%,
			rgba(40, 40, 50, 0.25) 40%,
			transparent 60%
		);
	}

	/* --- UI overlays --- */

	.click-hint {
		position: absolute;
		bottom: 10%;
		left: 50%;
		transform: translateX(-50%);
		z-index: 20;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.8s ease;
	}

	.click-hint.visible {
		opacity: 1;
	}

	.click-hint span {
		background: var(--sw-blue);
		color: white;
		padding: 10px 20px;
		border-radius: 20px;
		font-size: 13px;
		white-space: nowrap;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	/* Blind styles live inside window/Blind.svelte. */

	/* Subtle inner-glow during long-press boost — reads as "going faster". */
	.window-viewport.boosting {
		box-shadow:
			inset 0 0 40px rgba(255, 210, 120, 0.25),
			inset 0 0 80px rgba(255, 170, 80, 0.12);
		transition: box-shadow 0.3s ease;
	}

	/* ─── Window frame on/off ────────────────────────────────────────────────
	   When config.shell.windowFrame = false, all cabin-style chrome
	   disappears and the oval clip becomes a full rectangle — edge-to-edge
	   Cesium render. The blind still works (its clip rect goes square too)
	   so the user can still pull it down across the whole viewport. Mode
	   used for the 3-Pi panorama where the oval would break the seam.

	   Glass.svelte + Blind.svelte elements are in child-component scope, so
	   we reach into them via :global(). Wing silhouette stays inside
	   scene-content and is local to this file. */
	.window-container.no-frame :global(.glass-surface),
	.window-container.no-frame :global(.vignette),
	.window-container.no-frame :global(.glass-recess),
	.window-container.no-frame .wing-silhouette {
		visibility: hidden;
	}
	.window-container.no-frame .window-viewport {
		border-radius: 0 !important;
		box-shadow: none !important;
	}
	.window-container.no-frame :global(.blind-clip),
	.window-container.no-frame :global(.blind-overlay) {
		border-radius: 0;
	}
</style>
