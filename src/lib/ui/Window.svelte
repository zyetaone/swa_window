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
	import { useAppState } from "$lib/app-state.svelte";
	import { AIRCRAFT, FLIGHT_FEEL, WEATHER_EFFECTS } from "$lib/constants";
	import { clamp } from "$lib/utils";
	import { subscribe } from "$lib/game-loop";
	import { useBlind } from "./use-blind.svelte";
	import CesiumViewer from "$lib/cesium/CesiumViewer.svelte";
	import Weather from './Weather.svelte';
	import Compositor from '$lib/scene/compositor.svelte';
	const model = useAppState();
	const blind = useBlind(model);

	// ========================================================================
	// GAME LOOP — single RAF driving model.tick()
	// ========================================================================

	$effect(() =>
		subscribe((dt: number) => {
			model.tick(dt);
			model.reportFrame();
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
		const fx = WEATHER_EFFECTS[model.weather];
		const hazeContrast = 1 - model.haze * 0.08;
		const hazeSaturate = 1 - model.haze * 0.1;
		const brightness = timeBrightness * fx.filterBrightness;
		const w = model.flight.warpFactor;

		// Constant 0.35px blur — kills the pixel aliasing visible over large
		// flat ocean areas where Sentinel-2 tiles are low-res at cruise zoom.
		// Subtle enough that terrain detail still reads as crisp; no perceived
		// "soft focus" at normal viewing distance.
		const baseBlur = 0.35;

		const base = `brightness(${brightness.toFixed(2)}) contrast(${hazeContrast.toFixed(2)}) saturate(${hazeSaturate.toFixed(2)}) blur(${baseBlur}px)`;
		if (w < 0.01) return base;
		return `${base} blur(${(w * 5).toFixed(1)}px) brightness(${(1 + w * 0.3).toFixed(2)})`;
	});

	// --- Weather ---

	const rainOpacity = $derived(WEATHER_EFFECTS[model.weather].rainOpacity);
	const windAngle = $derived(WEATHER_EFFECTS[model.weather].windAngle);

	// --- Motion (unified from 4 independent layers) ---

	// Turbulence shakes the window (chrome/frame) — but the translation is
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
	class="window-container"
	role="region"
	aria-roledescription="airplane window"
	aria-label="Window Viewport"
>
	<!-- The oval window -->
	<button
		class="window-viewport"
		onclick={handleWindowClick}
		type="button"
		aria-label="Fly to a new destination"
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

		<!-- Fixed to glass (not affected by turbulence) -->

		<!-- z:9 — Glass vignette -->
		<div class="glass-surface" style:z-index={9}>
			<div
				class="glass-vignette"
				style:opacity={glassVignetteOpacity}
			></div>
		</div>

		<!-- z:10 — Vignette -->
		<div class="vignette" style:z-index={10}></div>

		<!-- z:11 — Glass recess rim shadow (depth illusion) -->
		<div class="glass-recess" style:z-index={11}></div>

		<!-- UI overlays — timed reveal (no :hover on touch kiosks) -->
		{#if showHint}
			<div class="click-hint visible">
				<span>Tap to fly somewhere new</span>
			</div>
		{/if}
	</button>

	<!-- Blind (useBlind composable) -->
	<div class="blind-clip" bind:this={blind.clipEl}>
		<div
			class="blind-overlay"
			class:discoverable={!model.blindOpen && !blind.hasAnimated}
			onanimationend={() => { blind.hasAnimated = true; }}
			onpointerdown={blind.onPointerDown}
			onpointermove={blind.onPointerMove}
			onpointerup={blind.onPointerUp}
			onkeydown={blind.onKeyDown}
			role="slider"
			tabindex={0}
			aria-label="Window blind — drag to open or close"
			aria-valuenow={Math.round(Math.abs(blind.dragY))}
			aria-valuemin={0}
			aria-valuemax={105}
			style:transform={blind.transform}
			style:transition={blind.transition}
			style:pointer-events={model.blindOpen ? 'none' : 'auto'}
		>
			<div class="blind-slats"></div>
		</div>
	</div>
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
	.glass-recess {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		box-shadow:
			/* Gentle recess where glass meets the metallic rim */
			inset 0 0 10px 4px rgba(0, 0, 0, 0.25),
			inset 2px 2px 6px rgba(0, 0, 0, 0.15);
	}

	/* --- Glass vignette --- */

	.glass-surface {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		overflow: hidden;
	}

	.glass-vignette {
		position: absolute;
		inset: 0;
		background: radial-gradient(
			circle at center,
			transparent 50%,
			rgba(0, 0, 0, 0.6) 100%
		);
		transition: opacity 2s;
	}

	/* --- Vignette --- */

	.vignette {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			ellipse 75% 65% at 50% 50%,
			transparent 55%,
			rgba(0, 0, 0, 0.08) 80%,
			rgba(0, 0, 0, 0.3) 100%
		);
	}

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

	/* --- Blind --- */

	.blind-clip {
		position: absolute;
		inset: var(--frame-width);
		border-radius: var(--inner-radius);
		overflow: hidden;
		z-index: 5;
		pointer-events: none;
	}

	.blind-overlay {
		position: absolute;
		inset: 0;
		border-radius: var(--inner-radius);
		background: rgba(240, 238, 235, 0.95);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		padding: 0;
		pointer-events: auto;
		touch-action: none;
	}

	.blind-slats {
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			180deg,
			rgba(230, 228, 225, 0.9) 0px,
			rgba(230, 228, 225, 0.9) 6px,
			rgba(210, 208, 205, 0.7) 6px,
			rgba(210, 208, 205, 0.7) 8px
		);
		box-shadow: inset 0 -20px 30px rgba(0, 0, 0, 0.1);
	}

	.blind-overlay::after {
		content: "";
		position: absolute;
		bottom: 8%;
		left: 30%;
		right: 30%;
		height: 14px;
		background:
			repeating-linear-gradient(
				180deg,
				transparent 0px,
				transparent 3px,
				rgba(0, 0, 0, 0.15) 3px,
				rgba(0, 0, 0, 0.15) 4px,
				transparent 4px,
				transparent 5px
			),
			linear-gradient(180deg, var(--sw-silver) 0%, #908880 100%);
		border-radius: 6px;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
	}

	@keyframes handle-breathe {
		0%, 100% { transform: translateY(0); opacity: 0.9; }
		50% { transform: translateY(-3px); opacity: 1; }
	}

	.blind-overlay.discoverable::after {
		animation: handle-breathe 1s ease-in-out 3;
	}
</style>
