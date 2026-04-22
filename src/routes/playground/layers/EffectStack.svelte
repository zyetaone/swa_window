<script lang="ts">
	/**
	 * EffectStack — unified post-process pipeline for pure-Three cells.
	 *
	 * Why this exists:
	 *   VolumetricClouds and PostFX each tried to own the render loop —
	 *   both called `autoRender.set(false)` and drove their own
	 *   `EffectComposer`. When both mounted in the same Canvas (cell 6),
	 *   whichever mounted last won and the other went dark.
	 *
	 * EffectStack consolidates the two into one composer. Both takram
	 * atmospherics (Clouds + AerialPerspective) and pmndrs post-fx
	 * (Bloom + LensFlare + Dithering) are Effect instances and share the
	 * same EffectComposer cleanly. We add passes conditionally based on
	 * the `clouds` / `postfx` props:
	 *
	 *   RenderPass
	 *   → [clouds on]   CloudsEffect + AerialPerspectiveEffect passes
	 *   → [postfx on]   Bloom + LensFlare + Dithering pass
	 *   (OutputPass is implicit at composer end)
	 *
	 * This is mounted inside a Threlte <Canvas>. It takes over
	 * `autoRender` for the duration of its lifetime.
	 *
	 * Async init: precomputed Bruneton atmosphere LUTs take ~1 s to
	 * generate. While loading, `clouds.skipRendering = true` keeps the
	 * pipeline safe.
	 */

	import { useTask, useThrelte } from '@threlte/core';
	import { onDestroy, untrack } from 'svelte';
	import * as THREE from 'three';
	import {
		Data3DTexture,
		LinearFilter,
		LinearMipMapLinearFilter,
		NoColorSpace,
		RedFormat,
		RepeatWrapping,
		TextureLoader,
	} from 'three';
	import type { Texture } from 'three';
	import {
		BloomEffect,
		EffectComposer,
		EffectPass,
		RenderPass,
	} from 'postprocessing';
	import { CloudsEffect } from '@takram/three-clouds';
	import {
		CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
		CLOUD_SHAPE_TEXTURE_SIZE,
		DEFAULT_LOCAL_WEATHER_URL,
		DEFAULT_SHAPE_DETAIL_URL,
		DEFAULT_SHAPE_URL,
		DEFAULT_TURBULENCE_URL,
	} from '@takram/three-clouds';
	import {
		AerialPerspectiveEffect,
		PrecomputedTexturesGenerator,
	} from '@takram/three-atmosphere';
	import {
		DEFAULT_STBN_URL,
		DataTextureLoader,
		STBNLoader,
		parseUint8Array,
	} from '@takram/three-geospatial';
	import {
		DitheringEffect,
		LensFlareEffect,
	} from '@takram/three-geospatial-effects';

	import { pg, getSunDirection } from '../lib/playground-state.svelte';

	// Baseline takram defaults; the sliders scale them each frame.
	// `localWeatherRepeat` scales inversely — smaller repeat = larger-looking clouds.
	const BASE_LOCAL_WEATHER_REPEAT = 100;
	const BASE_WEATHER_VELOCITY = 0.001;


	let { clouds = false, postfx = false }: { clouds?: boolean; postfx?: boolean } = $props();

	// Capture initial prop values — this component is designed to run with
	// stable props for its lifetime (cells 5-6 set them once at mount).
	// svelte-ignore state_referenced_locally
	const enableClouds = clouds;
	// svelte-ignore state_referenced_locally
	const enablePostfx = postfx;
	const { renderer, scene, camera, size, autoRender, invalidate, renderStage } = useThrelte();

	// --- Build the unified composer ------------------------------------
	const composer = new EffectComposer(renderer as THREE.WebGLRenderer, {
		// HalfFloat → enough headroom for bloom + clouds without banding.
		frameBufferType: THREE.HalfFloatType,
	});
	composer.addPass(new RenderPass(scene, camera.current));

	// --- Clouds + atmosphere (optional) --------------------------------
	let cloudsEffect: CloudsEffect | null = null;
	let aerial: AerialPerspectiveEffect | null = null;

	if (enableClouds) {
		cloudsEffect = new CloudsEffect();
		cloudsEffect.coverage = 0.3;
		cloudsEffect.localWeatherVelocity.set(0.001, 0);
		cloudsEffect.skipRendering = true; // gate until LUTs load

		aerial = new AerialPerspectiveEffect(camera.current);
		aerial.sky = false; // Disable so MapLibre terrain shows through!
		aerial.sunLight = true;
		aerial.skyLight = true;

		composer.addPass(new EffectPass(camera.current, cloudsEffect));
		composer.addPass(new EffectPass(camera.current, aerial));
	}

	// --- Post-FX (optional) --------------------------------------------
	let bloom: BloomEffect | null = null;
	let lensFlare: LensFlareEffect | null = null;
	let dithering: DitheringEffect | null = null;

	if (enablePostfx) {
		bloom = new BloomEffect({
			luminanceThreshold: 0.85,
			intensity: 0.4,
			radius: 0.4,
			mipmapBlur: true,
		});
		lensFlare = new LensFlareEffect();
		dithering = new DitheringEffect();
		composer.addPass(new EffectPass(camera.current, bloom, lensFlare, dithering));
	}

	// --- Renderer: AgX tone mapping (only when postfx is on) -----------
	const prevToneMapping = renderer.toneMapping;
	const prevExposure = renderer.toneMappingExposure;
	if (enablePostfx) {
		renderer.toneMapping = THREE.AgXToneMapping;
		renderer.toneMappingExposure = 1.0;
	}

	// --- Render-loop takeover ------------------------------------------
	const prevAutoRender = autoRender.current;
	autoRender.set(false);

	// --- Async LUT + cloud-texture init --------------------------------
	const texLoader = new TextureLoader();
	function load2D(url: string): Promise<Texture> {
		return new Promise((resolve, reject) => {
			texLoader.load(
				url,
				(t) => {
					t.minFilter = LinearMipMapLinearFilter;
					t.magFilter = LinearFilter;
					t.wrapS = RepeatWrapping;
					t.wrapT = RepeatWrapping;
					t.colorSpace = NoColorSpace;
					t.needsUpdate = true;
					resolve(t);
				},
				undefined,
				reject,
			);
		});
	}
	function load3D(url: string, s: number): Promise<Data3DTexture> {
		const loader = new DataTextureLoader(Data3DTexture, parseUint8Array, {
			width: s,
			height: s,
			depth: s,
			format: RedFormat,
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			wrapS: RepeatWrapping,
			wrapT: RepeatWrapping,
			wrapR: RepeatWrapping,
			colorSpace: NoColorSpace,
		});
		return new Promise((resolve, reject) => {
			loader.load(url, resolve, undefined, reject);
		});
	}
	function loadSTBN(url: string): Promise<Data3DTexture> {
		const loader = new STBNLoader();
		return new Promise((resolve, reject) => {
			loader.load(url, resolve, undefined, reject);
		});
	}

	async function initAtmosphere() {
		if (!cloudsEffect || !aerial) return;
		const [localWeather, shape, shapeDetail, turbulence, stbn] = await Promise.all([
			load2D(DEFAULT_LOCAL_WEATHER_URL),
			load3D(DEFAULT_SHAPE_URL, CLOUD_SHAPE_TEXTURE_SIZE),
			load3D(DEFAULT_SHAPE_DETAIL_URL, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE),
			load2D(DEFAULT_TURBULENCE_URL),
			loadSTBN(DEFAULT_STBN_URL),
		]);

		cloudsEffect.localWeatherTexture = localWeather;
		cloudsEffect.shapeTexture = shape;
		cloudsEffect.shapeDetailTexture = shapeDetail;
		cloudsEffect.turbulenceTexture = turbulence;
		cloudsEffect.stbnTexture = stbn;

		const gen = new PrecomputedTexturesGenerator(renderer);
		const luts = await gen.update();

		cloudsEffect.irradianceTexture = luts.irradianceTexture;
		cloudsEffect.scatteringTexture = luts.scatteringTexture;
		cloudsEffect.transmittanceTexture = luts.transmittanceTexture;
		cloudsEffect.singleMieScatteringTexture = luts.singleMieScatteringTexture ?? null;
		cloudsEffect.higherOrderScatteringTexture = luts.higherOrderScatteringTexture ?? null;

		aerial.irradianceTexture = luts.irradianceTexture;
		aerial.scatteringTexture = luts.scatteringTexture;
		aerial.transmittanceTexture = luts.transmittanceTexture;

		cloudsEffect.skipRendering = false;
		invalidate();
	}

	if (enableClouds) {
		initAtmosphere().catch((err) => {
			// eslint-disable-next-line no-console
			console.warn('[EffectStack] atmosphere init failed', err);
		});
	}

	// --- Frame loop ----------------------------------------------------
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
			if (cloudsEffect && aerial) {
				// Pipe Clouds' atmosphere composite hooks into AerialPerspective
				// — same wiring the takram demo uses (public-field version).
				aerial.overlay = cloudsEffect.atmosphereOverlay;
				aerial.shadow = cloudsEffect.atmosphereShadow;
				aerial.shadowLength = cloudsEffect.atmosphereShadowLength;

				// untrack: we read pg.* inside a render loop; no reactive deps.
				untrack(() => {
					const sun = getSunDirection();
					cloudsEffect!.sunDirection.copy(sun);
					aerial!.sunDirection.copy(sun);

					// Drive cloud controls from pg — all three uniforms are
					// per-frame mutable (confirmed from takram source: coverage →
					// parameterUniforms, localWeatherVelocity / Repeat are
					// Vector2 mutable in place).
					cloudsEffect!.coverage = pg.density;
					const velScale = pg.cloudSpeed * BASE_WEATHER_VELOCITY;
					cloudsEffect!.localWeatherVelocity.set(velScale, 0);
					const repeat = BASE_LOCAL_WEATHER_REPEAT / Math.max(0.1, pg.cloudScale);
					cloudsEffect!.localWeatherRepeat.set(repeat, repeat);
				});
			}
			composer.render(delta);
		},
		{ stage: renderStage, autoInvalidate: false },
	);

	// --- Teardown ------------------------------------------------------
	onDestroy(() => {
		autoRender.set(prevAutoRender);
		if (enablePostfx) {
			renderer.toneMapping = prevToneMapping;
			renderer.toneMappingExposure = prevExposure;
		}
		composer.dispose();
		cloudsEffect?.dispose();
		aerial?.dispose();
	});
</script>
