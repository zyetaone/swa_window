<script lang="ts">
	/**
	 * Pane — the airplane window pane.
	 *
	 * Owns the cabin chrome (oval frame, glass, blind, HUD) and composes
	 * the scene. GlobeLayer handles Cesium + Three overlay + watchdogs.
	 *
	 * Z-order SSOT: llib/scene/layers.ts.
	 */
	import { useAeroWindow } from "llib/model/aero-window.svelte";
	import { SKY_PALETTE } from "lcontent/palettes";
	import { Z } from "llib/scene/layers";
	import GlobeLayer from "./GlobeLayer.svelte";
	import Glass from "./window/Glass.svelte";
	import RainGlass from "./window/RainGlass.svelte";
	import Blind from "./window/Blind.svelte";
	import { useMouseParallax } from 'llib/world/use-mouse-parallax.svelte';

	const model = useAeroWindow();

	// ── Frame chrome ──────────────────────────────────────────────────────────

	const frameVisible = lderived(model.config.shell.windowFrame);
	const skyBackground = lderived(SKY_PALETTE[model.skyState].background);

	// ── Atmospheric CSS filters ───────────────────────────────────────────────

	const filterString = lderived.by(() => {
		const timeBrightness =
			model.skyState === "night" ? 1.0
			: model.skyState === "dawn" || model.skyState === "dusk" ? 0.95
			: 1.0;
		const hazeContrast = 1 - model.config.atmosphere.haze.amount * 0.08;
		const hazeSaturate = 1 - model.config.atmosphere.haze.amount * 0.1;
		const brightness = timeBrightness * model.config.atmosphere.weather.filterBrightness;
		const w = model.flight.warpFactor;
		const baseBlur = 0.35;
		const base = `brightness(l{brightness.toFixed(2)}) contrast(l{hazeContrast.toFixed(2)}) saturate(l{hazeSaturate.toFixed(2)}) blur(l{baseBlur}px)`;
		if (w < 0.01) return base;
		return `l{base} blur(l{(w * 5).toFixed(1)}px) brightness(l{(1 + w * 0.3).toFixed(2)})`;
	});

	// ── Motion (turbulence, breathing, parallax) ──────────────────────────────

	const turbulenceY = lderived(model.motion.motionOffsetY * 0.08);
	const turbulenceX = lderived(model.motion.motionOffsetX * 0.08);
	const turbulenceRotate = lderived(model.motion.motionOffsetY * 0.02);
	const breathingY = lderived(model.motion.breathingOffset * model.config.camera.motion.breathingAmplitude);
	const parallax = useMouseParallax();

	const motionTransform = lderived.by(() => {
		const x = turbulenceX + model.motion.engineVibeX + parallax.x;
		const y = turbulenceY + breathingY + model.motion.engineVibeY + parallax.y;
		const rotate = turbulenceRotate;
		const scale = 1 + model.motion.warpZoom;
		return `translate(l{x.toFixed(2)}px, l{y.toFixed(2)}px) rotate(l{rotate.toFixed(3)}deg) scale(l{scale.toFixed(4)})`;
	});

	// ── Glass ─────────────────────────────────────────────────────────────────

	const glassVignetteOpacity = lderived(
		model.skyState === "night" ? 0.3 : model.skyState === "day" ? 0.1 : 0.2,
	);

	// ── Timed click-hint ──────────────────────────────────────────────────────

	let showHint = lstate(false);
	leffect(() => {
		if (model.config.shell.blindOpen && !model.flight.isTransitioning) {
			const showTimer = setTimeout(() => { showHint = true; }, 3000);
			const hideTimer = setTimeout(() => { showHint = false; }, 8000);
			return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
		}
		showHint = false;
		return undefined;
	});
</script>

<div
	class={['window-container', !frameVisible && 'no-frame']}
	role="region"
	aria-roledescription="airplane window"
	aria-label="Window Viewport"
>
	<div
		class="window-viewport"
		style:background={skyBackground}
	>
		<div
			class="scene-content"
			style:transform={motionTransform}
			style:filter={filterString}
		>
			<div class="render-layer" style:z-index={Z.cesium}>
				<GlobeLayer />
			</div>
		</div>

		<RainGlass />
		<Glass {glassVignetteOpacity} />

		{#if showHint}
			<div class="click-hint visible">
				<span>Pull the blind down to fly somewhere new</span>
			</div>
		{/if}
	</div>

	<Blind />
</div>

<style>
	.window-container {
		--frame-width: 24px;
		--window-radius: 160px;
		--inner-radius: 136px;

		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		height: 82vh;
		width: auto;
		aspect-ratio: 2 / 3;
		max-width: 85vw;
		border-radius: var(--window-radius);
		overflow: hidden;
		z-index: 10;

		background: linear-gradient(
			135deg,
			#d8d8dd 0%,
			#b0b0b5 50%,
			#909098 100%
		);
		box-shadow:
			inset 0 0 30px rgba(0, 0, 0, 0.6),
			inset 0 0 4px rgba(0, 0, 0, 0.3),
			0 0 40px rgba(0, 0, 0, 0.5);
	}

	@media (orientation: portrait) {
		.window-container { width: 85vw; height: auto; max-height: 85vh; }
	}
	@media (orientation: landscape) {
		.window-container { height: 88vh; width: auto; }
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

	.click-hint.visible { opacity: 1; }

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

	.window-container.no-frame :global(.glass-surface),
	.window-container.no-frame :global(.vignette),
	.window-container.no-frame :global(.glass-recess) {
		visibility: hidden;
	}

	.window-container.no-frame {
		top: 0;
		left: 0;
		transform: none;
		width: 100vw;
		height: 100vh;
		max-width: none;
		max-height: none;
		aspect-ratio: auto;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
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
