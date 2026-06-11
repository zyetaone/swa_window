<script lang="ts">
	/**
	 * WindowChrome — the airplane-window CHROME (oval frame + viewport + glass
	 * vignette + pull-down Blind + turbulence/bank motion) WITHOUT any render
	 * content of its own. The caller supplies the scene (Cesium, Three overlay,
	 * …) as the default children snippet; WindowChrome wraps it in the window
	 * shell and composites Glass + Blind on top.
	 *
	 * This is the chrome half of Pane.svelte, factored out so the playground lab
	 * can preview the full shipping window (frame + blind + glass) over the
	 * Cesium + Three.js overlay without re-mounting CesiumViewer or pulling in
	 * the DOM Compositor (which would double the Three overlay's clouds).
	 *
	 * Unlike Pane it does NOT own the RAF tick — the host route already drives
	 * model.tick(). Drop it inside a relatively-positioned, full-bleed parent.
	 *
	 * The motion / filter / glass derivations mirror Pane.svelte; the window
	 * shape tokens + frame-on/off CSS are copied so the two stay visually
	 * identical. If these ever need to diverge, that's a sign to promote this
	 * component into Pane and delete Pane's inline copy.
	 */
	import type { Snippet } from 'svelte';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { SKY_PALETTE } from '$content/palettes';
	import Glass from './window/Glass.svelte';
	import RainGlass from './window/RainGlass.svelte';
	import Blind from './window/Blind.svelte';
	import { useMouseParallax } from './use-mouse-parallax.svelte';

	let { children }: { children: Snippet } = $props();

	const model = useAeroWindow();
	const frameVisible = $derived(model.config.shell.windowFrame);
	const skyBackground = $derived(SKY_PALETTE[model.skyState].background);

	// Haze + warp filter (mirrors Pane).
	const filterString = $derived.by(() => {
		const timeBrightness =
			model.skyState === 'night'
				? 1.0
				: model.skyState === 'dawn' || model.skyState === 'dusk'
					? 0.95
					: 1.0;
		const hazeContrast = 1 - model.config.atmosphere.haze.amount * 0.08;
		const hazeSaturate = 1 - model.config.atmosphere.haze.amount * 0.1;
		const brightness = timeBrightness * model.config.atmosphere.weather.filterBrightness;
		const w = model.flight.warpFactor;
		const base = `brightness(${brightness.toFixed(2)}) contrast(${hazeContrast.toFixed(2)}) saturate(${hazeSaturate.toFixed(2)}) blur(0.35px)`;
		if (w < 0.01) return base;
		return `${base} blur(${(w * 5).toFixed(1)}px) brightness(${(1 + w * 0.3).toFixed(2)})`;
	});

	// Unified motion (turbulence + breathing + engine vibe + bank + parallax).
	const parallax = useMouseParallax();
	const motionTransform = $derived.by(() => {
		const x = model.motion.motionOffsetX * 0.08 + model.motion.engineVibeX + parallax.x;
		const y =
			model.motion.motionOffsetY * 0.08 +
			model.motion.breathingOffset * model.config.camera.motion.breathingAmplitude +
			model.motion.engineVibeY +
			parallax.y;
		// Bank no longer spins the canvas — the camera roll tilts the horizon and
		// world-three/Wing banks the wing relative to it. Keep only turbulence here.
		const rotate = model.motion.motionOffsetY * 0.02;
		const scale = 1 + model.motion.warpZoom;
		return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rotate.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
	});

	const glassVignetteOpacity = $derived(
		model.skyState === 'night' ? 0.3 : model.skyState === 'day' ? 0.1 : 0.2,
	);
</script>

<div
	class={['window-container', !frameVisible && 'no-frame']}
	role="region"
	aria-roledescription="airplane window"
	aria-label="Window Viewport"
>
	<div class="window-viewport" style:background={skyBackground}>
		<div class="scene-content" style:transform={motionTransform} style:filter={filterString}>
			<div class="render-layer">
				{@render children()}
			</div>
		</div>

		<RainGlass />
		<Glass {glassVignetteOpacity} />
	</div>

	<Blind />
</div>

<style>
	/* Window shape tokens + frame — copied verbatim from Pane.svelte so the lab
	   window is pixel-identical to the shipping one. */
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
		background: linear-gradient(135deg, #d8d8dd 0%, #b0b0b5 50%, #909098 100%);
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

	/* Window-frame on/off — full-bleed rectangle when config.shell.windowFrame
	   is false (3-Pi panorama mode). Mirrors Pane.svelte. */
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
