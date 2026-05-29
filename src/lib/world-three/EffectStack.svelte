<script lang="ts">
	/**
	 * EffectStack — postprocessing.js pipeline on the Three.js overlay.
	 *
	 * Replaces Threlte's default `autoRenderTask` with an EffectComposer
	 * that renders the scene into an HDR (HalfFloat) render target, then
	 * runs a chain of subtle photoreal passes before output:
	 *
	 *     RenderPass            → scene → HDR texture
	 *     ↓
	 *     GodRaysEffect         → volumetric crepuscular rays from a sun
	 *                              mesh source. Killer cinematic effect
	 *                              for sunset/sunrise sun-through-atmosphere.
	 *                              The source mesh is invisible in the main
	 *                              render (.visible=false) — GodRays toggles
	 *                              it on only during its internal sampling.
	 *     ↓
	 *     BloomEffect           → soft glow on bright pixels (sun, moon,
	 *                              stars, bright cloud edges at sunset).
	 *                              Bloom is applied AFTER godrays so the
	 *                              ray shafts themselves pick up bloom.
	 *     ↓
	 *     ChromaticAberration   → subtle radial RGB fringe at edges
	 *     ↓
	 *     ToneMappingEffect     → ACES Filmic. Compresses HDR bloom
	 *                              highlights smoothly to LDR instead of
	 *                              clipping at 1.0 — eliminates the
	 *                              "blown-out white" feel.
	 *     ↓
	 *     VignetteEffect        → soft darken at corners
	 *     ↓
	 *     NoiseEffect           → film grain, premultiplied so transparent
	 *                              pixels stay transparent
	 *
	 * Threlte 8 wiring: stop `autoRenderTask`, register a task in
	 * `renderStage` that calls `composer.render(dt)` each frame.
	 */
	import { useThrelte, useTask } from '@threlte/core';
	import {
		EffectComposer,
		RenderPass,
		EffectPass,
		BloomEffect,
		ChromaticAberrationEffect,
		VignetteEffect,
		NoiseEffect,
		GodRaysEffect,
		ToneMappingEffect,
		ToneMappingMode,
		BlendFunction,
		KernelSize,
	} from 'postprocessing';
	import { HalfFloatType, Vector2, Mesh, SphereGeometry, MeshBasicMaterial } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { computeSunDirection, sunVisibility } from './sky';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// Sun source mesh for GodRays. Small bright sphere at the sun's
	// world position. .visible=false → not drawn in the main scene
	// (the SunGlow sprite handles the visible sun); GodRaysEffect
	// toggles .visible=true only during its own sampling pass to
	// generate the light-source mask.
	const SUN_PLACEMENT_M = 6e7;
	const sunSource = new Mesh(
		new SphereGeometry(8e5, 16, 16),
		new MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: false }),
	);
	sunSource.visible = false;
	sunSource.frustumCulled = false;
	ctx.scene.add(sunSource);

	// Track the sun position reactively. Same SUN_PLACEMENT and direction
	// computation as SunGlow / LensFlare so the rays align with the
	// visible sun sprite.
	$effect(() => {
		const dir = computeSunDirection(model.flight.camLon, model.timeOfDay);
		sunSource.position.set(
			dir[0] * SUN_PLACEMENT_M,
			dir[1] * SUN_PLACEMENT_M,
			dir[2] * SUN_PLACEMENT_M,
		);
	});

	const composer = new EffectComposer(ctx.renderer, {
		frameBufferType: HalfFloatType,
		multisampling: 0,
	});
	composer.addPass(new RenderPass(ctx.scene, ctx.camera.current));

	const godRays = new GodRaysEffect(ctx.camera.current, sunSource, {
		resolutionScale: 0.5,
		density: 0.94,
		decay: 0.93,
		weight: 0.45,
		exposure: 0.55,
		samples: 40,
		clampMax: 1.0,
		blur: true,
		kernelSize: KernelSize.SMALL,
	});

	const bloom = new BloomEffect({
		intensity: 0.55,
		// Kernel bumped LARGE → VERY_LARGE: even wider downsample halo.
		// With mipmapBlur enabled the extra cost is minimal (one more
		// downsample level), ~0.15 ms additional on Pi 5. The result is
		// a noticeably broader soft glow around cloud peaks and bright
		// celestial bodies — the "atmospheric softness" that helps the
		// scene read as photographed rather than rendered.
		kernelSize: KernelSize.VERY_LARGE,
		// Threshold dropped 0.42 → 0.38. Cloud peaks at brightness 0.74 ×
		// ambient ~0.6 ≈ 0.44 now firmly trip the bloom mask, giving
		// every bright cluster center a soft real-shader-blur halo. This
		// is the actual blur the user wants — not just sprite alpha.
		luminanceThreshold: 0.38,
		// Wider smoothing transition so the bloom ramps in gradually
		// rather than activating sharply at the threshold.
		luminanceSmoothing: 0.55,
		mipmapBlur: true,
	});

	const chromatic = new ChromaticAberrationEffect({
		offset: new Vector2(0.0008, 0.0012),
		radialModulation: true,
		modulationOffset: 0.40,
	});

	const tonemap = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });

	const vignette = new VignetteEffect({ offset: 0.35, darkness: 0.50 });

	const noise = new NoiseEffect({
		premultiply: true,
		blendFunction: BlendFunction.OVERLAY,
	});
	noise.blendMode.opacity.value = 0.10;

	composer.addPass(new EffectPass(
		ctx.camera.current,
		godRays,
		bloom,
		chromatic,
		tonemap,
		vignette,
		noise,
	));

	// Gate GodRays + bloom by sun visibility — no rays / less bloom at deep night.
	$effect(() => {
		const vis = sunVisibility(model.timeOfDay) * (1 - model.nightFactor * 0.95);
		godRays.blendMode.opacity.value = Math.min(1, vis * 1.5);
		// Raise bloom threshold at night: clouds are dimmer at night and
		// shouldn't bloom (they should read as silhouette against stars).
		// Base 0.38 (day, cloud peaks bloom softly) → 0.62 (night, only
		// moon + stars + city lights bloom).
		bloom.luminanceMaterial.uniforms.threshold.value = 0.38 + model.nightFactor * 0.24;
	});

	// Take over rendering: stop Threlte's auto-render, run composer in same stage.
	ctx.autoRenderTask.stop();
	useTask(
		(delta) => composer.render(delta),
		{ stage: ctx.renderStage, autoInvalidate: false },
	);

	// Reactive resize.
	$effect(() => {
		const { width, height } = ctx.size.current;
		composer.setSize(width, height);
	});

	$effect(() => () => {
		composer.dispose();
		godRays.dispose();
		bloom.dispose();
		chromatic.dispose();
		tonemap.dispose();
		vignette.dispose();
		noise.dispose();
		sunSource.geometry.dispose();
		(sunSource.material as MeshBasicMaterial).dispose();
		ctx.scene.remove(sunSource);
	});
</script>
