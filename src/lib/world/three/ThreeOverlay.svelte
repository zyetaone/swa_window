<script lang="ts">
	/**
	 * ThreeOverlay — Three.js canvas for Clouds cluster sprites.
	 *
	 * Camera sync via <CameraMirror> — copies Cesium's camera state into
	 * our PerspectiveCamera each frame via getCameraRead(). The canvas is
	 * transparent so Cesium shows through everywhere Three.js doesn't draw.
	 */
	import { Canvas, T } from '@threlte/core';
	import { PerspectiveCamera, WebGLRenderer, Color } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { attachCanvasLiveness } from '$lib/world/lifecycle-liveness';
	import CameraMirror from './CameraMirror.svelte';
	import Clouds from './Clouds.svelte';
	import Wing from './Wing.svelte';
	import { computeSunDirection, sunElevationSin } from '$lib/world/sky';
	import { lightingState } from '$lib/world/curves';

	type Vec3 = [number, number, number];

	const model = useAeroWindow();

	// $state.raw — Three.js camera mutated each frame, must not be proxied.
	let camera: PerspectiveCamera | undefined = $state.raw();

	// Teardown handles for the GL canvas we hand to the liveness watchdog.
	// Without these, a remount (svelte:boundary reset, HMR, auto-retry) leaves
	// the OLD canvas in the watchdog's Set. That canvas's context is lost by
	// definition, so `anyContextLost()` stays true forever and the watchdog
	// burns the hourly reload budget trying to recover a canvas that is gone.
	let detachLiveness: (() => void) | null = null;

	$effect(() => () => {
		detachLiveness?.();
		detachLiveness = null;
	});

	// Lighting driven by scene identity (location + time), NOT cam pose.
	// camLat/camLon move every frame; sun elev is constant for minutes — keying
	// $derived on cam thrash was pure invalidation with no visual gain.
	// Clouds/Wing re-read elevSin inside useTask if they need live cam.
	const _ambientTintScratch = new Color();
	const elevSin = $derived(sunElevationSin(model.currentLocation.lat, model.timeOfDay));
	const ambientTint = $derived.by(() => {
		const s = lightingState(model.timeOfDay, model.nightFactor, elevSin);
		return _ambientTintScratch.setRGB(s.ambientColor[0], s.ambientColor[1], s.ambientColor[2]);
	});
	// Pass elevSin here too even though ambientIntensity doesn't read it:
	// lightingState memos on (timeOfDay, nightFactor, sunElevSin), so omitting
	// it (legacy sin(0.4) default) alternated the memo key against ambientTint
	// and recomputed the full palette blend twice per frame.
	const ambientIntensity = $derived(
		lightingState(model.timeOfDay, model.nightFactor, elevSin).ambientIntensity,
	);
	const sunDirection = $derived.by(() => {
		const d = computeSunDirection(model.currentLocation.lon, model.timeOfDay) as Vec3;
		return [d[0], d[1], d[2]] as Vec3;
	});
</script>

<div class="three-overlay" aria-hidden="true">
	<Canvas
		createRenderer={(canvas) => {
			// Passing the previous teardown drops the old registration first, so a
			// re-created renderer can't orphan the earlier canvas in the watchdog.
			detachLiveness = attachCanvasLiveness(
				canvas as HTMLCanvasElement,
				'three-overlay',
				model.telemetry,
				detachLiveness,
			);
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

		<Clouds
			density={model.effectiveCloudDensity}
			nightFactor={model.nightFactor}
			ambientColor={ambientTint}
			ambientIntensity={ambientIntensity}
			sunDirection={sunDirection}
		/>

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
