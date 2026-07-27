<script lang="ts">
	/**
	 * ThreeOverlay — Three.js canvas for wing GLB + Clouds cluster sprites.
	 *
	 * Three.js stays ONLY for things Cesium genuinely can't do:
	 *   - Wing (camera-anchored SWA 737 GLB with yaw-stripped positioning
	 *     for 3-Pi panorama continuity — Cesium's Model API doesn't elegantly
	 *     handle this pattern).
	 *   - Clouds (PNG-sprite cluster composition at the cloud deck —
	 *     artistic-density CSS3D-style reads that don't match Cesium's
	 *     BillboardCollection aesthetic. CloudBillboardManager handles
	 *     the Cesium-native alternative behind the `useCesiumClouds` flag.)
	 *
	 * Cesium handles everything else natively:
	 *   - Stars     → scene.skyBox (Tycho-2 catalog)
	 *   - Sun glow  → scene.sun
	 *   - Moon      → scene.moon
	 *   - Bloom + tonemap → postProcessStages.bloom + tonemapper = ACES
	 *   - Lightning → LightningStage (post-process)
	 *   - Roads, Meteors, Rain, Sparkles, Venus → all migrated to Cesium
	 *     billboards in src/lib/world/
	 *
	 * Camera sync via <CameraMirror> — copies Cesium's camera state into
	 * our PerspectiveCamera each frame via getCameraRead() (typed read API,
	 * not raw viewer.camera.*WC). The canvas itself is transparent
	 * (`alpha: true` + `background: transparent`) so Cesium shows through
	 * everywhere Three.js doesn't draw.
	 *
	 * Logarithmic depth + far 1e9 keep WGS84 scale precision. Near 1.0 so
	 * camera-anchored cabin-space geometry renders without near-plane
	 * clipping. logarithmicDepthBuffer is designed for huge dynamic
	 * ranges — precision at distant Cesium tiles is unaffected.
	 */
	import { Canvas, T } from '@threlte/core';
	import { PerspectiveCamera, WebGLRenderer, Color } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { registerLivenessCanvas } from '$lib/shell/liveness';
	import CameraMirror from './CameraMirror.svelte';
	import Clouds from './Clouds.svelte';
	import { computeSunDirection, sunElevationSin } from '$lib/world/sky';
	import { lightingState } from '$lib/world/curves';
	import Wing from '$lib/shell/Wing.svelte';

	type Vec3 = [number, number, number];

	const model = useAeroWindow();

	// $state.raw — Three.js camera mutated each frame, must not be proxied.
	let camera: PerspectiveCamera | undefined = $state.raw();

	// Ambient lighting from the unified lighting SSOT (curves.ts) — Clouds
	// cluster sprites use this so their tinted reads match the day/dusk/night
	// palette instead of fighting it.
	const _ambientTintScratch = new Color();
	const ambientTint = $derived.by(() => {
		const elevSin = sunElevationSin(model.flight.camLat, model.timeOfDay);
		const s = lightingState(model.timeOfDay, model.nightFactor, elevSin);
		return _ambientTintScratch.setRGB(s.ambientColor[0], s.ambientColor[1], s.ambientColor[2]);
	});
	const ambientIntensity = $derived(
		lightingState(model.timeOfDay, model.nightFactor).ambientIntensity,
	);
	const sunDirection = $derived.by(() => {
		const d = computeSunDirection(model.flight.camLon, model.timeOfDay) as Vec3;
		return [d[0], d[1], d[2]] as Vec3;
	});
</script>

<div class="three-overlay" aria-hidden="true">
	<Canvas
		createRenderer={(canvas) => {
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

		<T.AmbientLight color={ambientTint} intensity={ambientIntensity} />

		<CameraMirror {camera} />

		<!-- PNG-sprite cloud clusters at the WGS84 cloud deck. The Three-side
		     ArtsyClouds style is the curated sky read for the ship route;
		     CloudBillboardManager (Cesium BillboardCollection) is the
		     alternative behind world.useCesiumClouds for hardware gate. -->
		<Clouds
			density={model.effectiveCloudDensity}
			nightFactor={model.nightFactor}
			ambientColor={ambientTint}
			ambientIntensity={ambientIntensity}
			sunDirection={sunDirection}
		/>

		<!-- SWA 737 wing GLB — camera-anchored with yaw-stripped positioning
		     for 3-Pi panorama continuity. -->
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