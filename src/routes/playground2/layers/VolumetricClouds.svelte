<script lang="ts">
	/**
	 * VolumetricClouds — commit 6 of the /playground2 layer visualizer.
	 *
	 * Wraps @takram/three-clouds' `CloudsEffect` so it renders inside a
	 * Threlte <Canvas>. The effect is a `postprocessing` Effect and MUST
	 * run through a `postprocessing.EffectComposer` — it cannot render
	 * itself in isolation. So we build a composer here, chain:
	 *
	 *     RenderPass(scene, camera)
	 *     EffectPass(CloudsEffect)
	 *     EffectPass(AerialPerspectiveEffect)
	 *
	 * …and we hand Threlte's default render off in favour of our own
	 * `composer.render()` call inside a `useTask` on the `renderStage`.
	 *
	 * Async init gotcha
	 * -----------------
	 * The cloud shader needs a big pile of precomputed atmosphere LUTs
	 * (transmittance, multiple-scattering, irradiance, mie, higher-order
	 * scattering). Generating those takes ~1 second and returns a
	 * Promise. Until the promise resolves we set `effect.skipRendering =
	 * true` so the composer paints the scene without the cloud pass —
	 * avoiding black frames / undefined-texture errors.
	 *
	 * Local weather + shape textures
	 * ------------------------------
	 * Loaded lazily via plain `TextureLoader` (2D RGBA) for weather and
	 * turbulence, and takram's `DataTextureLoader` / `STBNLoader` for the
	 * 3D noise textures. URLs come straight out of the library so no
	 * assets need to land in /static.
	 *
	 * Tuning
	 * ------
	 * `coverage = 0.3` + `localWeatherVelocity = (0.001, 0)` matches the
	 * takram demo the user shared.
	 */

	import { useTask, useThrelte } from '@threlte/core';
	import { onDestroy } from 'svelte';
	import {
		Data3DTexture,
		LinearFilter,
		LinearMipMapLinearFilter,
		NoColorSpace,
		RedFormat,
		RepeatWrapping,
		TextureLoader
	} from 'three';
	import type { Texture } from 'three';
	import { EffectComposer, EffectPass, RenderPass } from 'postprocessing';
	import { CloudsEffect } from '@takram/three-clouds';
	import {
		CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
		CLOUD_SHAPE_TEXTURE_SIZE,
		DEFAULT_LOCAL_WEATHER_URL,
		DEFAULT_SHAPE_DETAIL_URL,
		DEFAULT_SHAPE_URL,
		DEFAULT_TURBULENCE_URL
	} from '@takram/three-clouds';
	import {
		AerialPerspectiveEffect,
		PrecomputedTexturesGenerator
	} from '@takram/three-atmosphere';
	import {
		DEFAULT_STBN_URL,
		DataTextureLoader,
		STBNLoader,
		parseUint8Array
	} from '@takram/three-geospatial';

	import { sceneState } from '../lib/scene-state.svelte';
	import { sunVectorForSky } from '../lib/sun.svelte';

	const { renderer, scene, camera, autoRender, invalidate, renderStage } = useThrelte();

	// --- Build effect graph at module mount ------------------------------------

	const clouds = new CloudsEffect();
	clouds.coverage = 0.3;
	clouds.localWeatherVelocity.set(0.001, 0);
	// Cloud buffers are empty until precomputed LUTs load. Gate the pass.
	clouds.skipRendering = true;

	const aerial = new AerialPerspectiveEffect(camera.current);
	aerial.sky = true;
	aerial.sunLight = true;
	aerial.skyLight = true;

	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera.current));
	composer.addPass(new EffectPass(camera.current, clouds));
	composer.addPass(new EffectPass(camera.current, aerial));

	// Take over Threlte's rendering so we drive the composer instead.
	// Threlte v8 `autoRender` is a read-only store; use `.set()` for writes.
	// (PostFX layer uses the same pattern — matched here for consistency.)
	const priorAutoRender = autoRender.current;
	autoRender.set(false);

	// --- Async texture + LUT load ----------------------------------------------

	const texLoader = new TextureLoader();

	function load2D(url: string) {
		return new Promise<Texture>((resolve, reject) => {
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
				reject
			);
		});
	}

	function load3D(url: string, size: number) {
		const loader = new DataTextureLoader(Data3DTexture, parseUint8Array, {
			width: size,
			height: size,
			depth: size,
			format: RedFormat,
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			wrapS: RepeatWrapping,
			wrapT: RepeatWrapping,
			wrapR: RepeatWrapping,
			colorSpace: NoColorSpace
		});
		return new Promise<Data3DTexture>((resolve, reject) => {
			loader.load(url, resolve, undefined, reject);
		});
	}

	function loadSTBN(url: string) {
		const loader = new STBNLoader();
		return new Promise<Data3DTexture>((resolve, reject) => {
			loader.load(url, resolve, undefined, reject);
		});
	}

	async function initClouds() {
		const [localWeather, shape, shapeDetail, turbulence, stbn] = await Promise.all([
			load2D(DEFAULT_LOCAL_WEATHER_URL),
			load3D(DEFAULT_SHAPE_URL, CLOUD_SHAPE_TEXTURE_SIZE),
			load3D(DEFAULT_SHAPE_DETAIL_URL, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE),
			load2D(DEFAULT_TURBULENCE_URL),
			loadSTBN(DEFAULT_STBN_URL)
		]);

		clouds.localWeatherTexture = localWeather;
		clouds.shapeTexture = shape;
		clouds.shapeDetailTexture = shapeDetail;
		clouds.turbulenceTexture = turbulence;
		clouds.stbnTexture = stbn;

		// Precompute Bruneton atmosphere LUTs once. Same textures can
		// feed both CloudsEffect and AerialPerspectiveEffect.
		const gen = new PrecomputedTexturesGenerator(renderer);
		const luts = await gen.update();

		clouds.irradianceTexture = luts.irradianceTexture;
		clouds.scatteringTexture = luts.scatteringTexture;
		clouds.transmittanceTexture = luts.transmittanceTexture;
		clouds.singleMieScatteringTexture = luts.singleMieScatteringTexture ?? null;
		clouds.higherOrderScatteringTexture = luts.higherOrderScatteringTexture ?? null;

		aerial.irradianceTexture = luts.irradianceTexture;
		aerial.scatteringTexture = luts.scatteringTexture;
		aerial.transmittanceTexture = luts.transmittanceTexture;

		clouds.skipRendering = false;
		invalidate();
	}

	initClouds().catch((err) => {
		// eslint-disable-next-line no-console
		console.warn('[VolumetricClouds] init failed', err);
	});

	// --- Frame loop -------------------------------------------------------------

	// Wire the composer into Threlte's render stage. We pass the frame delta
	// through so `localWeatherVelocity` animates correctly, and we refresh
	// sun direction + overlay linkage each tick.
	useTask(
		(delta) => {
			// Pipe AerialPerspective's clouds-composite props straight from the
			// effect — the R3F wrapper does this via `transientStates`, but since
			// we own both effects here we can just wire their public fields.
			aerial.overlay = clouds.atmosphereOverlay;
			aerial.shadow = clouds.atmosphereShadow;
			aerial.shadowLength = clouds.atmosphereShadowLength;

			// Drive sun direction from shared scene state.
			const sun = sunVectorForSky(sceneState.timeOfDay, sceneState.lat);
			clouds.sunDirection.copy(sun);
			aerial.sunDirection.copy(sun);

			composer.render(delta);
		},
		{ stage: renderStage, autoInvalidate: false }
	);

	// --- Teardown ---------------------------------------------------------------

	onDestroy(() => {
		autoRender.set(priorAutoRender);
		composer.dispose();
		clouds.dispose();
		aerial.dispose();
	});
</script>
