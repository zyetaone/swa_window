<script lang="ts">
	/**
	 * Pane — the airplane window pane.
	 *
	 * Owns the cabin chrome (oval frame, glass, blind, HUD) and composes
	 * the scene. GlobeLayer handles Cesium + Three overlay + watchdogs.
	 *
		 */
	import { useAeroWindow } from "$lib/model/aero-window.svelte";
	import { SKY_PALETTE } from "$content/palettes";
		import GlobeLayer from "./GlobeLayer.svelte";
	import Glass from "./window/Glass.svelte";
	import RainGlass from "./window/RainGlass.svelte";
	import Blind from "./window/Blind.svelte";
	import { useMouseParallax } from '$lib/shell/use-mouse-parallax.svelte';
	import CabinClock from "./hud/CabinClock.svelte";
	import { doubleTap } from '$lib/shell/use-double-tap';

	const model = useAeroWindow();

	// Double-tap anywhere on the pane toggles the cabin clock. Attached on the
	// window CONTAINER, not the viewport: `<Blind />` is a SIBLING of
	// `.window-viewport`, and when the blind is open it lays a full-window
	// `.blind-grab` overlay on top to catch drag-to-close. A listener on the
	// viewport therefore never sees a tap in the middle of the window — the
	// overlay is not a descendant, so nothing bubbles to it. The container is
	// the nearest ancestor of BOTH, which is where the gesture has to live.
	// (Found by probing the running kiosk: taps landed on `.blind-grab` and the
	// handler never fired.)
	//
	// Routed through applyConfigPatch so the change is CRDT-stamped and
	// fleet-synced like every other config write — double-tap one Pi in a
	// panorama and all three agree.
	function toggleClock() {
		model.applyConfigPatch?.('shell.clockVisible', !model.config.shell.clockVisible);
	}

	// ── Frame chrome ──────────────────────────────────────────────────────────

const frameVisible = $derived(model.config.shell.windowFrame);
const skyPalette = $derived(SKY_PALETTE[model.skyState]);
const skyBackground = $derived(skyPalette.background);

// ── Atmospheric CSS filters ───────────────────────────────────────────────
// No base blur: `filter: blur()` on a layer that holds Cesium+Three forces a
// full-window intermediate bitmap every frame on Pi. Brightness alone is cheap.
// Warp still softens the glass briefly, but only while warpFactor is real.

const filterString = $derived.by(() => {
	const brightness = skyPalette.filterBrightness * model.config.atmosphere.weather.filterBrightness;
	const w = model.flight.warpFactor;
	if (w < 0.02) return `brightness(${brightness.toFixed(2)})`;
	// Single blur term (not stacked) + mild brighten during departure.
	return `brightness(${(brightness * (1 + w * 0.25)).toFixed(2)}) blur(${(w * 3.5).toFixed(1)}px)`;
});

// ── Motion (turbulence, breathing, parallax) ──────────────────────────────

const turbulenceY = $derived(model.motion.motionOffsetY * 0.08);
const turbulenceX = $derived(model.motion.motionOffsetX * 0.08);
const turbulenceRotate = $derived(model.motion.motionOffsetY * 0.02);
const breathingY = $derived(model.motion.breathingOffset * model.config.camera.motion.breathingAmplitude);
const parallax = useMouseParallax();

const motionTransform = $derived.by(() => {
	const x = turbulenceX + model.motion.engineVibeX + parallax.x;
	const y = turbulenceY + breathingY + model.motion.engineVibeY + parallax.y;
	const rotate = turbulenceRotate;
	const scale = 1 + model.motion.warpZoom;
	return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rotate.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
});

// ── Glass ─────────────────────────────────────────────────────────────────

const glassVignetteOpacity = $derived(skyPalette.glassVignette);
// Open/close coaching is the Blind chevron cluster only (first session).
// No timed toast here — it competed with the view and desynced across panes.
</script>

<div
	class={['window-container', !frameVisible && 'no-frame']}
	role="region"
	aria-roledescription="airplane window"
	aria-label="Window Viewport"
	use:doubleTap={{ onDoubleTap: toggleClock }}
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
			<div class="render-layer" style:z-index="0">
				<GlobeLayer />
			</div>
		</div>

		<RainGlass />
		<Glass {glassVignetteOpacity} />

		{#if model.config.shell.clockVisible}
			<CabinClock />
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
