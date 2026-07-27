<script lang="ts">
	/**
	 * ThreeOverlay — minimal Three.js canvas for the SWA 737 wing GLB.
	 *
	 * Cesium handles everything else natively:
	 *   - Stars     → scene.skyBox (Tycho-2 catalog)
	 *   - Sun glow  → scene.sun
	 *   - Moon      → scene.moon
	 *   - Bloom + tonemap → postProcessStages.bloom + tonemapper = ACES
	 *   - Lightning → CloudLightningManager (post-process)
	 *   - Clouds    → CloudBillboardManager (BillboardCollection, with useCesiumClouds flag)
	 *   - Roads, Meteors, Rain, Sparkles, Venus → all migrated to Cesium billboards
	 *     in `src/lib/world/`
	 *
	 * Three.js stays ONLY for the wing because Cesium's Model API doesn't
	 * elegantly handle the camera-anchored yaw-stripped positioning needed
	 * for a 3-Pi panorama with one continuous wing across the seam.
	 *
	 * Camera sync via <CameraMirror> — copies Cesium's camera state into
	 * our PerspectiveCamera each frame (Cesium-pull model, not push). The
	 * canvas itself is transparent (`alpha: true` + `background:
	 * transparent`) so Cesium shows through everywhere Three.js doesn't
	 * draw — but Three.js now draws almost nothing.
	 *
	 * Logarithmic depth + far 1e9 keep WGS84 scale precision. Near 1.0 so
	 * camera-anchored cabin-space geometry renders without near-plane
	 * clipping. logarithmicDepthBuffer is designed for huge dynamic
	 * ranges — precision at distant Cesium tiles is unaffected.
	 */
	import { Canvas, T } from '@threlte/core';
	import { PerspectiveCamera, WebGLRenderer } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { registerLivenessCanvas } from '$lib/shell/liveness';
	import CameraMirror from './CameraMirror.svelte';
	import Wing from '$lib/shell/Wing.svelte';

	const model = useAeroWindow();

	// $state.raw — Three.js camera mutated each frame, must not be proxied.
	let camera: PerspectiveCamera | undefined = $state.raw();
</script>

<div class="three-overlay" aria-hidden="true">
	<Canvas
		createRenderer={(canvas) => {
			// Production hardening — register with the liveness watchdog +
			// log context loss. A lost GL context makes draws silent no-ops
			// (nothing throws), so only the watchdog's poll can notice.
			registerLivenessCanvas(canvas as HTMLCanvasElement);
			canvas.addEventListener('webglcontextlost', (e: Event) => {
				e.preventDefault();
				model.telemetry.recordEvent('error', { where: 'three-overlay', event: 'webglcontextlost' });
			});
			return new WebGLRenderer({
				canvas,
				antialias: true,
				alpha: true,
				powerPreference: 'high-performance',
				logarithmicDepthBuffer: true,
			});
		}}
	>
		<T.PerspectiveCamera
			bind:ref={camera}
			makeDefault
			fov={model.config.camera.parallax.fovDeg}
			near={1}
			far={1e9}
		/>

		<CameraMirror {camera} />
		<Wing />
	</Canvas>
</div>

<style>
	.three-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 5;
	}
	.three-overlay :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
		background: transparent !important;
	}
</style>