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
	import {
		useAppState,
		AIRCRAFT,
		FLIGHT_FEEL,
		WEATHER_EFFECTS,
	} from "$lib/core";
	import { clamp } from "$lib/shared/utils";
	import { subscribe } from "$lib/engine/loop.svelte";
	import CesiumViewer from "$lib/engine/cesium/Globe.svelte";
	import CloudBlobs from './CloudBlobs.svelte';
	import Weather from './Weather.svelte';
	import MicroEvent from './MicroEvent.svelte';
	const model = useAppState();

	// ========================================================================
	// GAME LOOP — single RAF driving model.tick()
	// ========================================================================

	let elapsedTime = $state(0);

	$effect(() => {
		return subscribe((dt) => {
			model.tick(dt);
			model.reportFrame();
			elapsedTime += dt;
		});
	});

	// ========================================================================
	// ACTIONS
	// ========================================================================

	function handleWindowClick() {
		if (model.isTransitioning) return;
		const nextId = model.pickNextLocation();
		model.flyTo(nextId);
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
			(model.altitude - AIRCRAFT.FROST_START_ALTITUDE) / FROST_RANGE,
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
		const w = model.warpFactor;

		// Return 'none' when all factors are identity — avoids creating a
		// compositing layer that can break WebGL premultiplied alpha output
		const isIdentity = Math.abs(brightness - 1) < 0.005
			&& Math.abs(hazeContrast - 1) < 0.005
			&& Math.abs(hazeSaturate - 1) < 0.005
			&& w < 0.01;
		if (isIdentity) return 'none';

		const base = `brightness(${brightness.toFixed(2)}) contrast(${hazeContrast.toFixed(2)}) saturate(${hazeSaturate.toFixed(2)})`;
		if (w < 0.01) return base;
		return `${base} blur(${(w * 5).toFixed(1)}px) brightness(${(1 + w * 0.3).toFixed(2)})`;
	});

	// --- Clouds (inlined from CloudLayer) ---

	// Cloud perspective reserved for Option C evolution (layered cinema mode).
	// Currently the horizon-band CloudBlobs handles altitude internally.

	const cloudOpacity = $derived(model.effectiveCloudDensity);
	const cloudSpeed = $derived(model.cloudSpeed);

	// --- Weather (inlined from WeatherLayer) ---

	const rainOpacity = $derived(WEATHER_EFFECTS[model.weather].rainOpacity);
	const windAngle = $derived(WEATHER_EFFECTS[model.weather].windAngle);
	const lightningOpacity = $derived(model.lightningIntensity * 0.3);
	const lightningX = $derived(model.lightningX);
	const lightningY = $derived(model.lightningY);

	// --- Motion (unified from 4 independent layers) ---

	const turbulenceY = $derived(model.motionOffsetY * 0.3);
	const turbulenceX = $derived(model.motionOffsetX * 0.3);
	const turbulenceRotate = $derived(model.motionOffsetY * 0.02);
	const breathingY = $derived(
		model.breathingOffset * FLIGHT_FEEL.BREATHING_AMPLITUDE,
	);
	const bankDegrees = $derived(model.bankAngle);

	const motionTransform = $derived.by(() => {
		const x = turbulenceX + model.engineVibeX;
		const y = turbulenceY + breathingY + model.engineVibeY;
		const rotate = turbulenceRotate + bankDegrees;
		return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rotate.toFixed(3)}deg)`;
	});


	// --- Wing silhouette (dark gradient at bottom-left, shifting with bank) ---

	const wingTransform = $derived(
		`rotate(${(-2 + model.bankAngle * 0.3).toFixed(2)}deg)`,
	);

	// --- Micro-events ---

	const microEvent = $derived(model.microEvent);

	// --- Glass ---

	const glassVignetteOpacity = $derived(
		model.skyState === "night" ? 0.3 : model.skyState === "day" ? 0.1 : 0.2,
	);

	// --- Input / Gestures ---
	let touchStartY = 0;
	let touchStartX = 0;
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	const LONG_PRESS_MS = 8000;
	const SWIPE_THRESHOLD = 50;

	// --- Draggable blind (ported from feat/offline-tiles Windows version) ---
	// blindDragY: 0 = fully closed (visible), -105 = fully open (off-screen).
	// During drag, CSS transition is disabled for instant response.
	// On release, snap to open or closed with transition.
	let isDragging = $state(false);
	let blindDragY = $state(0);
	let dragStartBlindY = 0;
	let dragStartPointerY = 0;
	let blindContainerHeight = 0;
	const SNAP_THRESHOLD = 0.3;

	// Sync blindDragY with model.blindOpen when not dragging
	$effect(() => {
		if (!isDragging) {
			blindDragY = model.blindOpen ? -105 : 0;
		}
	});

	const blindTransform = $derived(
		`translateY(${blindDragY.toFixed(1)}%)`
	);

	const blindTransition = $derived(
		isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.22, 0.68, 0, 1.05)'
	);

	function getBlindHeight(): number {
		const el = document.querySelector('.blind-clip') as HTMLElement | null;
		return el?.offsetHeight ?? 1;
	}

	function startBlindDrag(pointerY: number) {
		if (model.isTransitioning) return;
		blindContainerHeight = getBlindHeight();
		isDragging = true;
		dragStartBlindY = blindDragY;
		dragStartPointerY = pointerY;
	}

	function moveBlindDrag(pointerY: number) {
		if (!isDragging) return;
		const deltaPixels = pointerY - dragStartPointerY;
		const deltaPct = (deltaPixels / blindContainerHeight) * 100;
		blindDragY = clamp(dragStartBlindY + deltaPct, -105, 0);
	}

	function endBlindDrag() {
		if (!isDragging) return;
		isDragging = false;
		const totalTravel = 105;
		const distanceTraveled = Math.abs(blindDragY - dragStartBlindY);
		const travelRatio = distanceTraveled / totalTravel;
		if (travelRatio > SNAP_THRESHOLD) {
			model.blindOpen = blindDragY < dragStartBlindY;
		}
		// If not past threshold, $effect syncs blindDragY back
	}

	function handleStart(y: number, x: number) {
		touchStartY = y;
		touchStartX = x;
		startBlindDrag(y);
		pressTimer = setTimeout(() => {
			model.flyTo(model.pickNextLocation());
			pressTimer = null;
		}, LONG_PRESS_MS);
	}

	function handleMove(y: number) {
		if (isDragging) {
			moveBlindDrag(y);
			if (pressTimer) {
				clearTimeout(pressTimer);
				pressTimer = null;
			}
		}
	}

	function handleEnd(y: number, x: number) {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}

		if (isDragging) {
			endBlindDrag();
			return;
		}

		const dy = y - touchStartY;
		const dx = x - touchStartX;

		if (Math.abs(dy) > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
			if (dy > 0 && model.blindOpen) {
				model.blindOpen = false;
			} else if (dy < 0 && !model.blindOpen) {
				model.blindOpen = true;
			}
		}
	}

	function onTouchStart(e: TouchEvent) {
		handleStart(e.touches[0].clientY, e.touches[0].clientX);
	}

	function onTouchMove(e: TouchEvent) {
		handleMove(e.touches[0].clientY);
	}

	function onTouchEnd(e: TouchEvent) {
		handleEnd(e.changedTouches[0].clientY, e.changedTouches[0].clientX);
	}

	function onMouseDown(e: MouseEvent) {
		handleStart(e.clientY, e.clientX);
	}

	function onMouseMove(e: MouseEvent) {
		handleMove(e.clientY);
	}

	function onMouseUp(e: MouseEvent) {
		handleEnd(e.clientY, e.clientX);
	}

	// Double-click and long-press disabled for kiosk mode —
	// only drag gesture controls the blind, preventing accidental triggers.

	// --- Blind handle discoverability (plays once per session) ---
	let hasAnimated = $state(false);

	function onHandleAnimationEnd() {
		hasAnimated = true;
	}

	// --- Timed click-hint (touch kiosks have no :hover) ---
	let showHint = $state(false);
	$effect(() => {
		if (model.blindOpen && !model.isTransitioning) {
			const showTimer = setTimeout(() => { showHint = true; }, 3000);
			const hideTimer = setTimeout(() => { showHint = false; }, 8000);
			return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
		}
		showHint = false;
		return undefined;
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
<div
	class="window-container"
	role="region"
	aria-roledescription="airplane window"
	aria-label="Window Viewport"
	tabindex="0"
	ontouchstart={onTouchStart}
	ontouchmove={onTouchMove}
	ontouchend={onTouchEnd}
	onmousedown={onMouseDown}
	onmousemove={onMouseMove}
	onmouseup={onMouseUp}
	onkeydown={(e) => {
		if (e.key === "Enter" || e.key === " ") {
			model.toggleBlind();
		}
	}}
>
	<!-- The oval window -->
	<button
		class="window-viewport"
		onclick={handleWindowClick}
		type="button"
		aria-label="Fly to a new destination"
		style:background={skyBackground}
		disabled={model.isTransitioning}
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

			<!-- z:1 — Cloud deck along the horizon (viewed from above at cruise) -->
			<div class="render-layer" style:z-index={1}>
				<CloudBlobs
					density={cloudOpacity}
					speed={cloudSpeed}
					skyState={model.skyState}
					time={elapsedTime}
					heading={model.heading}
					altitude={model.altitude}
					windAngle={windAngle}
				/>
			</div>

			<!-- z:2 Rain + Lightning, z:5 Frost -->
			<Weather {rainOpacity} {windAngle} {lightningOpacity} {lightningX} {lightningY} {frostAmount} />

			<!-- z:3 — Micro-events (shooting stars, birds, contrails) -->
			<MicroEvent event={microEvent} />

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

	<!-- Blind -->
	<div class="blind-clip">
		<div
			class="blind-overlay"
			class:discoverable={!model.blindOpen && !hasAnimated}
			onanimationend={onHandleAnimationEnd}
			role="slider"
			aria-label="Window blind — drag to open or close"
			aria-valuenow={Math.round(Math.abs(blindDragY))}
			aria-valuemin={0}
			aria-valuemax={105}
			style:transform={blindTransform}
			style:transition={blindTransition}
			style:pointer-events={model.blindOpen ? 'none' : 'auto'}
		>
			<div class="blind-slats"></div>
			<!-- Removing blind-label for cleaner, physical look -->
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
		/* transform, transition, pointer-events set via inline style for drag support */
	}

	.blind-overlay:disabled {
		cursor: not-allowed;
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

	/* --- Blind handle discoverability pulse (once per session) --- */

	@keyframes handle-breathe {
		0%,
		100% {
			transform: translateY(0);
			opacity: 0.9;
		}
		50% {
			transform: translateY(-3px);
			opacity: 1;
		}
	}

	.blind-overlay.discoverable::after {
		animation: handle-breathe 1s ease-in-out 3;
	}

	/* .blind-label telemetry badge removed for de-cluttered UI */

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
</style>
