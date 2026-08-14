<script lang="ts">
	/**
	 * Pane — the airplane window pane.
	 *
	 * Owns the cabin chrome (oval frame, glass, blind, HUD) and composes
	 * the scene. GlobeLayer handles Cesium + Three overlay + watchdogs.
	 *
	 * Media modes (video / slideshow) force full-bleed (no oval frame) and
	 * stack MediaStage over a *parked* GlobeLayer so return-to-flight does
	 * not cold-remount Cesium.
	 */
	import { useAeroWindow } from "$lib/model/aero-window.svelte";
	import { SKY_PALETTE } from "$content/palettes";
	import GlobeLayer from "./GlobeLayer.svelte";
	import MediaStage from "$lib/shell/media/MediaStage.svelte";
	import Glass from "$lib/shell/window/Glass.svelte";
	import RainGlass from "$lib/shell/window/RainGlass.svelte";
	import Blind from "$lib/shell/window/Blind.svelte";
	import { useMouseParallax } from '$lib/shell/use-mouse-parallax.svelte';
	import CabinClock from "$lib/shell/passenger/hud/CabinClock.svelte";
	import { doubleTap } from '$lib/shell/use-double-tap';

	const model = useAeroWindow();
	const isFlight = $derived(model.displayMode === 'flight');

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
	// Media always full-bleeds the wall; oval frame is flight-only chrome.
	const frameVisible = $derived(isFlight && model.config.shell.windowFrame);
	const skyPalette = $derived(SKY_PALETTE[model.skyState]);
	const skyBackground = $derived(isFlight ? skyPalette.background : '#000');

// Scene brightness lives in Cesium exposure (atmosphere.ts), not CSS filter —
// filter on a WebGL layer costs a full intermediate bitmap every frame on Pi.
// Warp feel is warpZoom scale on .scene-content + a short exposure lift.

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
	class={['window-container', !frameVisible && 'no-frame', !isFlight && 'media-mode']}
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
			style:transform={isFlight ? motionTransform : 'none'}
		>
			<!-- Globe stays mounted (parked) under media so return-to-flight is warm. -->
			<div class={['render-layer', 'globe-layer', !isFlight && 'parked']} style:z-index="0">
				<GlobeLayer active={isFlight} />
			</div>
			{#if !isFlight}
				<div class="render-layer media-layer" style:z-index="1">
					{#if model.displayMode === 'video'}
						<MediaStage mode="video" videoUrl={model.videoUrl} />
					{:else}
						<MediaStage mode="screensaver" slideshow={model.slideshow} />
					{/if}
				</div>
			{/if}
		</div>

		{#if isFlight}
			<RainGlass />
			<Glass {glassVignetteOpacity} />
		{/if}

		{#if model.config.shell.clockVisible}
			<CabinClock />
		{/if}
	</div>

	{#if isFlight}
		<Blind />
	{/if}
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

	/* Keep WebGL canvas in the tree (display:none can lose GL size on some GPUs). */
	.render-layer.parked {
		visibility: hidden;
		pointer-events: none;
	}

	/* Glass.svelte collapsed .glass-surface/.vignette/.glass-recess into one
	   .glass element (Phase 15.5b) — hide that, or the rim vignette + recess
	   shadow paint edge-to-edge in no-frame/full-bleed mode. */
	.window-container.no-frame :global(.glass) {
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
		/* Media full-bleed: no frame inset. */
		inset: 0;
	}

	.window-container.media-mode .window-viewport {
		/* Zero frame width while media so CSS var-based insets don't leave a rim. */
		--frame-width: 0px;
		--inner-radius: 0px;
	}

	.window-container.no-frame :global(.blind-clip),
	.window-container.no-frame :global(.blind-overlay) {
		border-radius: 0;
	}
</style>
