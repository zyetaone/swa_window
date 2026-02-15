<script lang="ts">
	/**
	 * Window - Layer compositor + game loop
	 *
	 * Owns the RAF tick loop (single game clock).
	 * Composes: Cesium (terrain) + CSS effect overlays (glass, weather, clouds).
	 *
	 * Z-order:
	 *   0: Cesium (terrain, buildings, NASA night lights, CartoDB roads)
	 *   1: Clouds (CSS blur gradients)
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
	import { clamp } from "$lib/core/utils";
	import CesiumViewer from "./CesiumViewer.svelte";
	const model = useAppState();

	// ========================================================================
	// GAME LOOP — single RAF driving model.tick()
	// ========================================================================

	$effect(() => {
		let lastTime = performance.now();
		let raf: number;
		let consecutiveErrors = 0;

		function loop(now: number) {
			try {
				const dt = Math.min((now - lastTime) / 1000, 0.1);
				lastTime = now;
				model.tick(dt);
				consecutiveErrors = 0;
			} catch {
				consecutiveErrors++;
				if (consecutiveErrors >= 10) {
					// Clear potentially corrupt persisted state before reload
					try { localStorage.removeItem('aero-window-v2'); } catch { /* noop */ }
					window.location.reload();
					return;
				}
			}
			raf = requestAnimationFrame(loop);
		}

		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	// ========================================================================
	// ACTIONS
	// ========================================================================

	function handleBlindClick() {
		model.blindOpen = true;
	}

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
		const base = `brightness(${brightness.toFixed(2)}) contrast(${hazeContrast.toFixed(2)}) saturate(${hazeSaturate.toFixed(2)})`;

		// Compose warp filter into same string to avoid double stacking context
		const w = model.warpFactor;
		if (w < 0.01) return base;
		return `${base} blur(${(w * 5).toFixed(1)}px) brightness(${(1 + w * 0.3).toFixed(2)})`;
	});

	// --- Clouds (inlined from CloudLayer) ---

	const cloudOpacity = $derived(model.effectiveCloudDensity);
	const cloudSpeed = $derived(model.cloudSpeed);
	const isNight = $derived(model.skyState === "night");

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
	const microEventProgress = $derived(
		microEvent ? microEvent.elapsed / microEvent.duration : 0,
	);

	// --- Glass ---

	const glassVignetteOpacity = $derived(
		model.skyState === "night" ? 0.3 : model.skyState === "day" ? 0.1 : 0.2,
	);

	// --- Input / Gestures ---
	let touchStartY = 0;
	let touchStartX = 0;
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	const LONG_PRESS_MS = 8000; // 8 seconds hold to cruise
	const SWIPE_THRESHOLD = 50;

	function handleStart(y: number, x: number) {
		touchStartY = y;
		touchStartX = x;
		pressTimer = setTimeout(() => {
			model.flyTo(model.pickNextLocation());
			pressTimer = null;
		}, LONG_PRESS_MS);
	}

	function handleEnd(y: number, x: number) {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}

		const dy = y - touchStartY;
		const dx = x - touchStartX;

		// Vertical Swipe Detection (ignore if horizontal movement is dominant)
		if (Math.abs(dy) > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
			if (dy > 0 && model.blindOpen) {
				// Swipe Down -> Close Blind
				model.blindOpen = false;
			} else if (dy < 0 && !model.blindOpen) {
				// Swipe Up -> Open Blind
				model.blindOpen = true;
			}
		}
	}

	function onTouchStart(e: TouchEvent) {
		handleStart(e.touches[0].clientY, e.touches[0].clientX);
	}

	function onTouchEnd(e: TouchEvent) {
		handleEnd(e.changedTouches[0].clientY, e.changedTouches[0].clientX);
	}

	function onMouseDown(e: MouseEvent) {
		handleStart(e.clientY, e.clientX);
	}

	function onMouseUp(e: MouseEvent) {
		handleEnd(e.clientY, e.clientX);
	}

	function onDoubleClick() {
		model.toggleBlind();
	}

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

<div
	class="window-container"
	role="region"
	aria-roledescription="airplane window"
	aria-label="Window Viewport"
	tabindex="0"
	ontouchstart={onTouchStart}
	ontouchend={onTouchEnd}
	onmousedown={onMouseDown}
	onmouseup={onMouseUp}
	ondblclick={onDoubleClick}
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

			<!-- z:1 — Clouds (CSS blur gradients) -->
			{#if cloudOpacity > 0.01}
				<div
					class="cloud-container"
					class:night={isNight}
					style:z-index={1}
					style:opacity={cloudOpacity}
					style:--cloud-speed={cloudSpeed}
				>
					<div class="cloud-layer near"></div>
					<div class="cloud-layer mid"></div>
					<div class="cloud-layer far"></div>
				</div>
			{/if}

			<!-- z:2 — Rain streaks -->
			{#if rainOpacity > 0}
				<div
					class="rain-layer"
					style:z-index={2}
					style:opacity={rainOpacity}
					style:--angle="{windAngle}deg"
				>
					<div class="rain-near"></div>
					<div class="rain-far"></div>
				</div>
			{/if}

			<!-- z:2 — Positional lightning flash -->
			{#if lightningOpacity > 0}
				<div
					class="lightning-flash"
					style:z-index={2}
					style:opacity={lightningOpacity}
					style:--lx="{lightningX}%"
					style:--ly="{lightningY}%"
				></div>
			{/if}

			<!-- z:3 — Micro-events (shooting stars, birds, contrails) -->
			{#if microEvent}
				<div
					class="micro-event micro-event-{microEvent.type}"
					style:z-index={3}
					style:left="{microEvent.x}%"
					style:top="{microEvent.y}%"
					style:--progress={microEventProgress}
				></div>
			{/if}

			<!-- z:5 — Frost at high altitude -->
			{#if frostAmount > 0}
				<div
					class="frost-layer"
					style:z-index={5}
					style:opacity={frostAmount * 0.3}
				></div>
			{/if}

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
		<button
			class="blind-overlay"
			class:open={model.blindOpen}
			class:discoverable={!model.blindOpen && !hasAnimated}
			onclick={handleBlindClick}
			onanimationend={onHandleAnimationEnd}
			type="button"
			aria-label="Open window blind"
			disabled={model.isTransitioning}
		>
			<div class="blind-slats"></div>
			<!-- Removing blind-label for cleaner, physical look -->
		</button>
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

		transition: background 3s ease;
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
		pointer-events: auto;
		transform: translateY(0);
		transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.blind-overlay.open {
		transform: translateY(-105%);
		pointer-events: none;
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

	/* --- Clouds (inlined from CloudLayer) --- */

	.cloud-container {
		position: absolute;
		inset: 0;
		pointer-events: none;
		transition: opacity 2s ease;
		contain: layout style paint;
	}

	.cloud-layer {
		position: absolute;
		inset: -20%;
		border-radius: 50%;
		will-change: transform;
	}

	.cloud-layer.near {
		background: radial-gradient(
				ellipse 45% 30% at 25% 40%,
				rgba(255, 255, 255, 0.6) 0%,
				transparent 70%
			),
			radial-gradient(
				ellipse 50% 35% at 70% 55%,
				rgba(255, 255, 255, 0.5) 0%,
				transparent 70%
			),
			radial-gradient(
				ellipse 35% 25% at 50% 30%,
				rgba(255, 255, 255, 0.4) 0%,
				transparent 65%
			);
		filter: blur(12px);
		animation: cloud-drift-near calc(40s / var(--cloud-speed, 1)) linear
			infinite;
	}

	.cloud-layer.mid {
		background: radial-gradient(
				ellipse 40% 28% at 60% 45%,
				rgba(240, 245, 255, 0.4) 0%,
				transparent 65%
			),
			radial-gradient(
				ellipse 30% 22% at 30% 60%,
				rgba(240, 245, 255, 0.35) 0%,
				transparent 65%
			);
		filter: blur(16px);
		animation: cloud-drift-mid calc(55s / var(--cloud-speed, 1)) linear
			infinite;
	}

	.cloud-layer.far {
		background: radial-gradient(
				ellipse 55% 35% at 45% 50%,
				rgba(230, 240, 255, 0.25) 0%,
				transparent 60%
			),
			radial-gradient(
				ellipse 30% 20% at 75% 35%,
				rgba(230, 240, 255, 0.2) 0%,
				transparent 60%
			);
		filter: blur(20px);
		animation: cloud-drift-far calc(70s / var(--cloud-speed, 1)) linear
			infinite;
	}

	.cloud-container.night .cloud-layer.near {
		background: radial-gradient(
				ellipse 45% 30% at 25% 40%,
				rgba(100, 110, 140, 0.5) 0%,
				transparent 70%
			),
			radial-gradient(
				ellipse 50% 35% at 70% 55%,
				rgba(100, 110, 140, 0.4) 0%,
				transparent 70%
			),
			radial-gradient(
				ellipse 35% 25% at 50% 30%,
				rgba(100, 110, 140, 0.3) 0%,
				transparent 65%
			);
	}

	.cloud-container.night .cloud-layer.mid {
		background: radial-gradient(
				ellipse 40% 28% at 60% 45%,
				rgba(80, 90, 120, 0.35) 0%,
				transparent 65%
			),
			radial-gradient(
				ellipse 30% 22% at 30% 60%,
				rgba(80, 90, 120, 0.3) 0%,
				transparent 65%
			);
	}

	.cloud-container.night .cloud-layer.far {
		background: radial-gradient(
				ellipse 55% 35% at 45% 50%,
				rgba(60, 70, 100, 0.2) 0%,
				transparent 60%
			),
			radial-gradient(
				ellipse 30% 20% at 75% 35%,
				rgba(60, 70, 100, 0.15) 0%,
				transparent 60%
			);
	}

	@keyframes cloud-drift-near {
		from {
			transform: translateX(-8%);
		}
		to {
			transform: translateX(8%);
		}
	}

	@keyframes cloud-drift-mid {
		from {
			transform: translateX(6%) translateY(-2%);
		}
		to {
			transform: translateX(-6%) translateY(2%);
		}
	}

	@keyframes cloud-drift-far {
		from {
			transform: translateX(-4%) translateY(1%);
		}
		to {
			transform: translateX(4%) translateY(-1%);
		}
	}

	/* --- Weather: Rain (inlined from WeatherLayer) --- */

	.rain-layer {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		transition: opacity 1s ease;
	}

	.rain-near,
	.rain-far {
		position: absolute;
		inset: -50%;
		background: repeating-linear-gradient(
			var(--angle),
			transparent 0px,
			transparent 4px,
			rgba(180, 200, 255, 0.3) 4px,
			rgba(180, 200, 255, 0.3) 5px
		);
	}

	.rain-near {
		background-size: 100% 80px;
		animation: rain-fall 0.4s linear infinite;
	}

	.rain-far {
		background-size: 100% 50px;
		opacity: 0.5;
		animation: rain-fall 0.6s linear infinite;
	}

	@keyframes rain-fall {
		from {
			transform: translate3d(0, -80px, 0);
		}
		to {
			transform: translate3d(0, 0, 0);
		}
	}

	/* --- Weather: Lightning --- */

	.lightning-flash {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			ellipse 60% 50% at var(--lx) var(--ly),
			rgba(200, 200, 255, 1) 0%,
			rgba(180, 180, 255, 0.6) 30%,
			rgba(150, 150, 230, 0.2) 60%,
			transparent 85%
		);
		mix-blend-mode: screen;
		transition: opacity 0.05s linear;
	}

	/* --- Effect overlays --- */

	.frost-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			ellipse 100% 100% at 50% 50%,
			transparent 40%,
			rgba(200, 220, 255, 0.4) 70%,
			rgba(180, 200, 255, 0.6) 90%
		);
		animation: frost-breathe 8s ease-in-out infinite alternate;
	}

	@keyframes frost-breathe {
		from {
			opacity: 0.8;
		}
		to {
			opacity: 1;
		}
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

	/* --- Micro-events --- */

	.micro-event {
		position: absolute;
		pointer-events: none;
	}

	.micro-event-shooting-star {
		width: 2px;
		height: 60px;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.9) 0%,
			rgba(200, 220, 255, 0.5) 40%,
			transparent 100%
		);
		transform: rotate(-35deg);
		opacity: calc(1 - var(--progress));
		animation: shooting-star 1.5s linear forwards;
	}

	@keyframes shooting-star {
		from {
			transform: rotate(-35deg) translate(0, 0);
		}
		to {
			transform: rotate(-35deg) translate(120px, 200px);
		}
	}

	.micro-event-bird {
		width: 12px;
		height: 4px;
		background: rgba(20, 20, 20, 0.6);
		border-radius: 50%;
		opacity: calc(1 - var(--progress) * var(--progress));
		animation: bird-fly 8s linear forwards;
	}

	.micro-event-bird::before,
	.micro-event-bird::after {
		content: "";
		position: absolute;
		top: -2px;
		width: 8px;
		height: 3px;
		background: rgba(20, 20, 20, 0.5);
		border-radius: 50%;
		animation: bird-flap 0.3s ease-in-out infinite alternate;
	}

	.micro-event-bird::before {
		left: -6px;
		transform-origin: right center;
	}

	.micro-event-bird::after {
		right: -6px;
		transform-origin: left center;
	}

	@keyframes bird-fly {
		from {
			transform: translate(0, 0);
		}
		to {
			transform: translate(-200px, 30px);
		}
	}

	@keyframes bird-flap {
		from {
			transform: rotate(-15deg);
		}
		to {
			transform: rotate(15deg);
		}
	}

	.micro-event-contrail {
		width: 1px;
		height: 1px;
		opacity: calc(0.6 * (1 - var(--progress)));
	}

	.micro-event-contrail::after {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		width: calc(var(--progress) * 200px);
		height: 2px;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255, 255, 255, 0.4) 30%,
			rgba(255, 255, 255, 0.6) 100%
		);
		filter: blur(1px);
		transform: rotate(-5deg);
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
