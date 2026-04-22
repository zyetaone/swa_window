/**
 * post-composer.svelte.ts — Three.js EffectComposer controller for the
 * playground's post-process stack.
 *
 * Pipeline (in order):
 *   1. RenderPass    — draws a fullscreen-quad sampling tDiffuse into the
 *                      composer's read-target. The quad uses a copy of
 *                      MapLibre's canvas (fed by syncMaplibreTexture).
 *   2. ColorGradePass — SWA night color-grade (night-grade.glsl).
 *   3. UnrealBloomPass — widens bright pixels into soft halos. Tuned to
 *                      match Cesium prod's bloom (contrast≈128,
 *                      brightness≈-0.3, sigma≈3.5). three.js UnrealBloom
 *                      exposes strength / radius / threshold; we map:
 *                        strength  ← emissive punch (≈ prod contrast/100)
 *                        radius    ← sigma-like spread
 *                        threshold ← 1 - |brightness| → only bright
 *                                    fragments contribute
 *   4. WaterPass     — Cesium-style animated water: scrolling normals +
 *                      Fresnel reflection + sun specular, masked by
 *                      chroma-key against the palette's live water
 *                      color. Runs AFTER bloom so bloom halos aren't
 *                      smeared, and the chroma-key early-outs on non-
 *                      water fragments.
 *   5. OutputPass    — sRGB encoding + tone-mapping output.
 *
 * The composer's input is a plane textured with MapLibre's canvas. Each
 * frame, we upload the MapLibre canvas into a THREE.CanvasTexture —
 * that's the "read the composited MapLibre frame" step (Option B from
 * the task brief). Option A (shared GL context via CustomLayer) was
 * explored; it's a clean fit for per-layer 3D content but not for
 * post-processing the composited frame, because MapLibre writes to the
 * default framebuffer and doesn't expose the backbuffer texture. Option
 * B is reliable and ~1 texImage2D/frame overhead — negligible at
 * 1440×900.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import { createColorGradePass, updateColorGradeUniforms } from './passes/ColorGradePass';
import { createWaterPass, type WaterPassHandle, type WaterUniforms } from './passes/WaterPass';

/** Bloom tuning — tightened from prod after first-light test: MapLibre's
 * VIIRS raster input is hotter than Cesium's atmosphere-dimmed globe, so
 * bloom at 0.85 strength + 0.75 threshold was painting huge white halos
 * over whole cities. Lower strength + higher threshold narrows bloom to
 * only truly bright pixels (bright intersections, not whole districts). */
const BLOOM_STRENGTH = 0.38;
const BLOOM_RADIUS = 0.35;
const BLOOM_THRESHOLD = 0.88;

export interface PostComposerHandle {
	readonly composer: EffectComposer;
	readonly renderer: THREE.WebGLRenderer;
	readonly colorGrade: ShaderPass;
	readonly bloom: UnrealBloomPass;
	readonly water: WaterPassHandle;
	/** Upload a DOM canvas (MapLibre's) into the composer's input texture. */
	syncInput(canvas: HTMLCanvasElement): void;
	/** Push live uniform values this frame. */
	setUniforms(u: {
		nightFactor: number;
		dawnDuskFactor: number;
		lightIntensity: number;
		water?: WaterUniforms;
	}): void;
	/** Resize renderer + bloom + composer when the host canvas resizes. */
	resize(width: number, height: number, dpr?: number): void;
	/** Draw one frame into the overlay canvas. */
	render(): void;
	/** Tear everything down. */
	dispose(): void;
}

/**
 * Build the composer against the overlay canvas. The overlay canvas sits
 * on top of MapLibre and receives the post-processed pixels.
 */
export function createPostComposer(overlayCanvas: HTMLCanvasElement): PostComposerHandle {
	const renderer = new THREE.WebGLRenderer({
		canvas: overlayCanvas,
		alpha: true,
		antialias: false, // post-process handles its own smoothness; no MSAA needed here
		premultipliedAlpha: false,
	});
	renderer.setClearColor(0x000000, 0);
	renderer.autoClear = false;

	const width = overlayCanvas.clientWidth || 1;
	const height = overlayCanvas.clientHeight || 1;
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	renderer.setPixelRatio(dpr);
	renderer.setSize(width, height, false);

	// ── Input scene: one fullscreen plane textured with the MapLibre canvas.
	// Using an OrthographicCamera + fullscreen quad — the classic pattern
	// for feeding raw pixels into an EffectComposer.
	const scene = new THREE.Scene();
	const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	const inputTexture = new THREE.CanvasTexture(document.createElement('canvas'));
	inputTexture.minFilter = THREE.LinearFilter;
	inputTexture.magFilter = THREE.LinearFilter;
	inputTexture.generateMipmaps = false;
	// MapLibre's canvas is Y-flipped relative to Three's expected UVs.
	inputTexture.flipY = true;
	const quadMat = new THREE.MeshBasicMaterial({ map: inputTexture, transparent: true });
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
	scene.add(quad);

	const composer = new EffectComposer(renderer);
	composer.setPixelRatio(dpr);
	composer.setSize(width, height);

	const renderPass = new RenderPass(scene, camera);
	composer.addPass(renderPass);

	const colorGrade = createColorGradePass();
	composer.addPass(colorGrade);

	const bloom = new UnrealBloomPass(
		new THREE.Vector2(width, height),
		BLOOM_STRENGTH,
		BLOOM_RADIUS,
		BLOOM_THRESHOLD,
	);
	composer.addPass(bloom);

	// ─────────────────────────────────────────────────────────────────────
	// WaterPass — Cesium-style animated water: scrolling normals + fresnel +
	// sun specular, masked by chroma-key against the live palette water
	// color. Runs AFTER bloom so city-light halos aren't smeared; water
	// pixels are replaced outright where the mask is strong. Early-outs
	// on non-water fragments so the shader is near-free off-water.
	// ─────────────────────────────────────────────────────────────────────
	const water = createWaterPass();
	composer.addPass(water.pass);

	const outputPass = new OutputPass();
	composer.addPass(outputPass);

	// ── Input sync — paint MapLibre's canvas onto a 2D canvas, then
	// upload it as our input texture. Using an intermediate canvas avoids
	// cross-context readbacks and handles DPR correctly.
	const inputCanvas = inputTexture.image as HTMLCanvasElement;
	const inputCtx = inputCanvas.getContext('2d', { alpha: false });

	function syncInput(mlCanvas: HTMLCanvasElement): void {
		if (!inputCtx) return;
		const w = mlCanvas.width;
		const h = mlCanvas.height;
		if (inputCanvas.width !== w || inputCanvas.height !== h) {
			inputCanvas.width = w;
			inputCanvas.height = h;
		}
		inputCtx.drawImage(mlCanvas, 0, 0);
		inputTexture.needsUpdate = true;
	}

	function setUniforms(u: {
		nightFactor: number;
		dawnDuskFactor: number;
		lightIntensity: number;
		water?: WaterUniforms;
	}): void {
		updateColorGradeUniforms(colorGrade, u);
		// Let bloom fade to nothing during the day — no point burning
		// fillrate on a pass that has nothing bright to bloom.
		bloom.enabled = u.nightFactor > 0.02;
		if (u.water) water.setUniforms(u.water);
	}

	function resize(w: number, h: number, newDpr?: number): void {
		const pixelRatio = Math.min(newDpr ?? window.devicePixelRatio ?? 1, 2);
		renderer.setPixelRatio(pixelRatio);
		renderer.setSize(w, h, false);
		composer.setPixelRatio(pixelRatio);
		composer.setSize(w, h);
		bloom.setSize(w, h);
	}

	function render(): void {
		renderer.clear();
		composer.render();
	}

	function dispose(): void {
		inputTexture.dispose();
		quadMat.dispose();
		quad.geometry.dispose();
		bloom.dispose?.();
		water.dispose();
		composer.dispose();
		renderer.dispose();
	}

	return {
		composer,
		renderer,
		colorGrade,
		bloom,
		water,
		syncInput,
		setUniforms,
		resize,
		render,
		dispose,
	};
}

/**
 * Convenience — compute dawn/dusk factor from the canonical night
 * factor. Peaks at 1.0 when nightFactor == 0.5 (mid-transition) and is
 * 0 at both full-day and full-night.
 */
export function dawnDuskFrom(nightFactor: number): number {
	const nf = Math.max(0, Math.min(1, nightFactor));
	return 4 * nf * (1 - nf);
}
