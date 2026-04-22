<script lang="ts">
	/**
	 * PostFX — commit 7 of the /playground2 layer visualizer.
	 *
	 * Post-processing pipeline for cells with the `postfx` layer active.
	 * Applies:
	 *   1. Bloom                   (pmndrs postprocessing, Zlib)
	 *   2. LensFlareEffect         (@takram/three-geospatial-effects, MIT)
	 *   3. DitheringEffect         (@takram/three-geospatial-effects, MIT)
	 *   4. AgX tone mapping        (on the renderer itself)
	 *
	 * Strategy — render-loop takeover
	 * --------------------------------
	 * pmndrs' EffectComposer expects to drive `renderer.render(...)` itself.
	 * If Threlte's auto-render also runs every frame we'd get two passes
	 * fighting over the framebuffer (and tone-mapping would double-apply).
	 *
	 * Threlte gives us a clean seam for this: the `autoRender` flag in
	 * the context fragment. Flipping it to `false` halts the built-in
	 * `autoRenderTask` and lets us own the render stage. We register our
	 * own `useTask` in `renderStage` that calls `composer.render()` — same
	 * place Threlte would have rendered, just with our pipeline on top.
	 *
	 * AgX tone mapping lives on the renderer itself (NOT as a pipeline
	 * pass) so that every pass in the chain can work in linear space and
	 * the final output goes through AgX once. The pmndrs README flags the
	 * usual warning — with high-precision frame buffers a ToneMappingEffect
	 * is the "correct" way, but for this layer visualizer the practical
	 * renderer-level approach matches prod behaviour and keeps the chain
	 * simple.
	 *
	 * Cleanup is important: we restore the previous tone mapping and
	 * re-enable autoRender on destroy so that if PostFX is toggled off
	 * mid-session the rest of the app keeps rendering normally.
	 */

	import { useTask, useThrelte } from '@threlte/core';
	import {
		BloomEffect,
		EffectComposer,
		EffectPass,
		RenderPass,
	} from 'postprocessing';
	import {
		DitheringEffect,
		LensFlareEffect,
	} from '@takram/three-geospatial-effects';
	import * as THREE from 'three';

	const { renderer, scene, camera, size, autoRender, renderStage } = useThrelte();

	// --- Build the composer + effect chain (once, imperative) -------------
	const composer = new EffectComposer(renderer as THREE.WebGLRenderer, {
		// HalfFloat buffers avoid banding through bloom; AgX on the
		// renderer handles the final LDR conversion.
		frameBufferType: THREE.HalfFloatType,
	});

	composer.addPass(new RenderPass(scene, camera.current));

	const bloom = new BloomEffect({
		luminanceThreshold: 0.85,
		intensity: 0.4,
		radius: 0.4,
		mipmapBlur: true,
	});

	const lensFlare = new LensFlareEffect();
	const dithering = new DitheringEffect();

	composer.addPass(new EffectPass(camera.current, bloom, lensFlare, dithering));

	// --- Renderer state: AgX tone mapping ---------------------------------
	const prevToneMapping = renderer.toneMapping;
	const prevExposure = renderer.toneMappingExposure;
	renderer.toneMapping = THREE.AgXToneMapping;
	renderer.toneMappingExposure = 1.0;

	// --- Hand-off: stop Threlte's auto-render, drive composer ourselves --
	const prevAutoRender = autoRender.current;
	autoRender.set(false);

	// Keep the composer sized to the canvas — Threlte updates `size` on
	// resize and `useTask` reruns every frame, but composer.setSize is
	// idempotent so this is cheap.
	let lastWidth = -1;
	let lastHeight = -1;

	useTask(
		(delta) => {
			const { width, height } = size.current;
			if (width !== lastWidth || height !== lastHeight) {
				composer.setSize(width, height);
				lastWidth = width;
				lastHeight = height;
			}
			// If the camera binding swapped (e.g. user switched cameras),
			// keep the RenderPass camera in sync. Cheap pointer compare.
			composer.render(delta);
		},
		{ stage: renderStage, autoInvalidate: false },
	);

	// --- Cleanup ----------------------------------------------------------
	$effect(() => {
		return () => {
			renderer.toneMapping = prevToneMapping;
			renderer.toneMappingExposure = prevExposure;
			autoRender.set(prevAutoRender);
			composer.dispose();
		};
	});
</script>
