/**
 * water-overlay.ts — minimal water post-process pipeline for /playground2.
 *
 * This is a trimmed fork of playground1's post-composer + WaterPass. The
 * playground1 stack also runs color-grade + UnrealBloom; here we keep
 * JUST the water re-paint so each /playground2 cell can stack its own
 * overlays independently and we can compose them later if we want.
 *
 * Pipeline (per cell):
 *   RenderPass (fullscreen quad sampling MapLibre canvas texture)
 *   → WaterShaderPass (chroma-key + multi-scale normals + shore ripple)
 *   → OutputPass (sRGB encode)
 *
 * Input sync: Option B from playground1 — we drawImage() MapLibre's
 * canvas onto a 2D canvas, then upload as a CanvasTexture. This keeps
 * the water overlay GL-context-independent of MapLibre's.
 *
 * Ported shader content lives inline (as a string) to avoid cross-route
 * imports — playground2 layers must be self-contained per the task
 * brief. The shader is verbatim from
 * src/routes/playground/three/shaders/water.glsl with added tuning
 * constants where the original used literals.
 *
 * Normal map: /textures/water-normals.jpg — Cesium's Apache-2.0 sample
 * (already in /static/textures/).
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ─── Shader source ──────────────────────────────────────────────────────
// Copied from src/routes/playground/three/shaders/water.glsl. Keeping
// the shader inline (rather than `?raw` importing across routes) per the
// "only touch playground2/layers" rule.
const WATER_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tDiffuse;
uniform sampler2D tWaterNormals;

uniform vec3  u_waterBase;
uniform float u_waterKeyTolerance;

uniform vec3  u_sunDirScreen;
uniform vec3  u_sunColor;
uniform vec3  u_skyReflection;

uniform float u_nightFactor;
uniform float u_dawnDuskFactor;
uniform float u_waterIntensity;
uniform float u_time;

// Tuning knobs — exposed as uniforms so we can dial the effect from the
// host without editing the shader. Defaults mirror playground1's values.
uniform float u_horizonLow;       // gate taper start (vUv.y)
uniform float u_horizonHigh;      // gate taper end   (vUv.y)
uniform float u_specStrengthDay;  // specular day-gain
uniform float u_reflectStrength;  // fresnel-scaled sky-reflection gain

varying vec2 vUv;

vec3 sampleWaterNormal(vec2 uv, float t, float distFade) {
	vec2 uvFar  = uv * 3.5  + vec2( 0.012,  0.007) * t;
	vec3 nFar   = texture2D(tWaterNormals, uvFar).rgb  * 2.0 - 1.0;

	vec2 uvMid  = uv * 8.0  + vec2(-0.028,  0.018) * t;
	vec3 nMid   = texture2D(tWaterNormals, uvMid).rgb  * 2.0 - 1.0;

	vec2 uvNear = uv * 18.0 + vec2( 0.045, -0.035) * t;
	vec3 nNear  = texture2D(tWaterNormals, uvNear).rgb * 2.0 - 1.0;

	float wMid  = smoothstep(0.15, 0.55, distFade);
	float wNear = smoothstep(0.45, 0.90, distFade);

	vec3 n = nFar + nMid * wMid + nNear * wNear;
	float flatten = mix(0.05, 0.18, distFade);
	n = mix(vec3(0.0, 0.0, 1.0), n, flatten);
	return normalize(n + vec3(1e-5));
}

void main() {
	vec4 frame = texture2D(tDiffuse, vUv);
	vec3 rgb   = frame.rgb;

	// Horizon gate — water can't appear above the horizon.
	float horizonGate = 1.0 - smoothstep(u_horizonLow, u_horizonHigh, vUv.y);

	// Chroma-key mask against palette water color.
	float d = distance(rgb, u_waterBase);
	float chromaMask = 1.0 - smoothstep(u_waterKeyTolerance * 0.6, u_waterKeyTolerance, d);
	float mask = chromaMask * horizonGate;

	// Shoreline proxy from the mid-value of the chroma-mask transition.
	float shoreBoost = 1.0 - 4.0 * abs(chromaMask - 0.55);
	shoreBoost = clamp(shoreBoost, 0.0, 1.0) * horizonGate;

	if (mask < 0.01 || u_waterIntensity < 0.01) {
		gl_FragColor = frame;
		return;
	}

	float distFade = 1.0 - clamp(vUv.y / 0.45, 0.0, 1.0);
	float shoreDistFade = clamp(distFade + 0.35 * shoreBoost, 0.0, 1.0);
	vec3 n = sampleWaterNormal(vUv, u_time, shoreDistFade);

	if (shoreBoost > 0.05) {
		vec2 uvRipple = vUv * 36.0 + vec2(0.18, -0.12) * u_time;
		vec3 nRipple = texture2D(tWaterNormals, uvRipple).rgb * 2.0 - 1.0;
		n = normalize(n + nRipple * 0.15 * shoreBoost);
	}

	float fresnel = pow(clamp(1.0 - n.z, 0.0, 1.0), 5.0);

	vec3 sunDir = normalize(u_sunDirScreen + vec3(1e-5));
	vec3 reflected = reflect(-sunDir, n);
	float specAngle = max(reflected.z, 0.0);
	float specExp = mix(64.0, 160.0, 1.0 - distFade);
	float specular = pow(specAngle, specExp);
	float sunAlt = clamp(u_sunDirScreen.z, 0.0, 1.0);
	float specDistBoost = mix(0.85, 1.7, 1.0 - distFade);
	specular *= sunAlt * specDistBoost * (1.0 + u_dawnDuskFactor * 0.8);

	vec3 waterBase = rgb * 0.95;
	vec3 reflectionTerm = u_skyReflection * fresnel * u_reflectStrength;
	vec3 specularTerm = u_sunColor * specular * u_specStrengthDay * (1.0 - u_nightFactor * 0.9);

	vec3 water = waterBase + reflectionTerm + specularTerm;
	water = mix(water, waterBase + u_skyReflection * fresnel * 0.20,
	            u_nightFactor * 0.65);

	float alpha = mask * u_waterIntensity;
	rgb = mix(rgb, water, alpha);

	gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), frame.a);
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Live uniform payload pushed per-frame by the Svelte wrapper. */
export type WaterOverlayUniforms = {
	/** 0 day, 1 night. */
	nightFactor: number;
	/** Peaks at 1 mid dawn/dusk, 0 at full day / full night. */
	dawnDuskFactor: number;
	/** RGB 0–1 — the base fill color MapLibre paints over water. */
	waterBase: THREE.Vector3Tuple;
	/** Chroma-key tolerance. 0.18 is a good starting point. */
	waterKeyTolerance?: number;
	/** Screen-space sun direction (x horiz, y vert, z altitude-above-horizon). */
	sunDirScreen: THREE.Vector3Tuple;
	/** Sun disc RGB 0–1. */
	sunColor: THREE.Vector3Tuple;
	/** What the water reflects back at grazing angles (sky palette). */
	skyReflection: THREE.Vector3Tuple;
	/** Effect master — 0 disables, 1 full. */
	waterIntensity?: number;
	/** Monotonic seconds for normal-map scroll. */
	time: number;
};

export interface WaterOverlayHandle {
	/** Upload the source map canvas into our input texture for next render. */
	syncInput(mapCanvas: HTMLCanvasElement): void;
	/** Push uniforms for next render. */
	setUniforms(u: WaterOverlayUniforms): void;
	/** Resize renderer + composer to host pixel size. */
	resize(width: number, height: number, dpr?: number): void;
	/** Render one frame. */
	render(): void;
	/** Dispose all GL resources. */
	dispose(): void;
}

const DEFAULT_TOLERANCE = 0.18;

/**
 * Build a water overlay against the given overlay canvas. The canvas
 * should be absolute-positioned over the source map canvas; callers
 * pass `syncInput(mapCanvas)` each RAF to pipe the map pixels in.
 */
export function createWaterOverlay(overlayCanvas: HTMLCanvasElement): WaterOverlayHandle {
	const renderer = new THREE.WebGLRenderer({
		canvas: overlayCanvas,
		alpha: true,
		antialias: false,
		premultipliedAlpha: false,
	});
	renderer.setClearColor(0x000000, 0);
	renderer.autoClear = false;

	const width = overlayCanvas.clientWidth || 1;
	const height = overlayCanvas.clientHeight || 1;
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	renderer.setPixelRatio(dpr);
	renderer.setSize(width, height, false);

	// ── Input scene: fullscreen quad textured with the source canvas. ──
	const scene = new THREE.Scene();
	const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

	const inputCanvas = document.createElement('canvas');
	const inputCtx = inputCanvas.getContext('2d', { alpha: false });
	const inputTexture = new THREE.CanvasTexture(inputCanvas);
	inputTexture.minFilter = THREE.LinearFilter;
	inputTexture.magFilter = THREE.LinearFilter;
	inputTexture.generateMipmaps = false;
	inputTexture.flipY = true;
	const quadMat = new THREE.MeshBasicMaterial({ map: inputTexture, transparent: true });
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
	scene.add(quad);

	// ── Composer + passes. ─────────────────────────────────────────────
	const composer = new EffectComposer(renderer);
	composer.setPixelRatio(dpr);
	composer.setSize(width, height);

	const renderPass = new RenderPass(scene, camera);
	composer.addPass(renderPass);

	const waterPass = new ShaderPass({
		uniforms: {
			tDiffuse:            { value: null as THREE.Texture | null },
			tWaterNormals:       { value: null as THREE.Texture | null },
			u_waterBase:         { value: new THREE.Vector3(0.15, 0.32, 0.45) },
			u_waterKeyTolerance: { value: DEFAULT_TOLERANCE },
			u_sunDirScreen:      { value: new THREE.Vector3(0, 0.5, 0.8) },
			u_sunColor:          { value: new THREE.Vector3(1.0, 0.95, 0.85) },
			u_skyReflection:     { value: new THREE.Vector3(0.55, 0.70, 0.90) },
			u_nightFactor:       { value: 0 },
			u_dawnDuskFactor:    { value: 0 },
			u_waterIntensity:    { value: 0 },
			u_time:              { value: 0 },
			// Tuning knobs (defaults match playground1 literals).
			u_horizonLow:        { value: 0.38 },
			u_horizonHigh:       { value: 0.52 },
			u_specStrengthDay:   { value: 0.5 },
			u_reflectStrength:   { value: 0.35 },
		},
		vertexShader: VERT,
		fragmentShader: WATER_FRAG,
	});
	composer.addPass(waterPass);

	const outputPass = new OutputPass();
	composer.addPass(outputPass);

	// ── Normal-map load. Until loaded, intensity forced to 0. ──────────
	let normalTex: THREE.Texture | null = null;
	let lastRequestedIntensity = 0.35;
	const loader = new THREE.TextureLoader();
	loader.load(
		'/textures/water-normals.jpg',
		(tex) => {
			tex.wrapS = THREE.RepeatWrapping;
			tex.wrapT = THREE.RepeatWrapping;
			tex.minFilter = THREE.LinearMipmapLinearFilter;
			tex.magFilter = THREE.LinearFilter;
			tex.generateMipmaps = true;
			tex.colorSpace = THREE.NoColorSpace;
			tex.anisotropy = 4;
			normalTex = tex;
			waterPass.uniforms.tWaterNormals.value = tex;
			waterPass.uniforms.u_waterIntensity.value = lastRequestedIntensity;
		},
		undefined,
		(err) => {
			// Silent-fail: no water effect until the texture is available.
			// eslint-disable-next-line no-console
			console.warn('[WaterOverlay] normal map failed to load', err);
		},
	);

	function syncInput(mapCanvas: HTMLCanvasElement): void {
		if (!inputCtx) return;
		const w = mapCanvas.width;
		const h = mapCanvas.height;
		if (w <= 0 || h <= 0) return;
		if (inputCanvas.width !== w || inputCanvas.height !== h) {
			inputCanvas.width = w;
			inputCanvas.height = h;
		}
		inputCtx.drawImage(mapCanvas, 0, 0);
		inputTexture.needsUpdate = true;
	}

	function setUniforms(u: WaterOverlayUniforms): void {
		const uf = waterPass.uniforms;
		uf.u_nightFactor.value = u.nightFactor;
		uf.u_dawnDuskFactor.value = u.dawnDuskFactor;
		uf.u_time.value = u.time;
		if (u.waterKeyTolerance != null) uf.u_waterKeyTolerance.value = u.waterKeyTolerance;
		if (u.waterIntensity != null) {
			lastRequestedIntensity = u.waterIntensity;
			// Only reflect intensity once the normal map is loaded — before
			// then the shader's early-out keeps it a no-op.
			if (normalTex) uf.u_waterIntensity.value = u.waterIntensity;
		}
		(uf.u_waterBase.value as THREE.Vector3).fromArray(u.waterBase);
		(uf.u_sunDirScreen.value as THREE.Vector3).fromArray(u.sunDirScreen);
		(uf.u_sunColor.value as THREE.Vector3).fromArray(u.sunColor);
		(uf.u_skyReflection.value as THREE.Vector3).fromArray(u.skyReflection);
	}

	function resize(w: number, h: number, newDpr?: number): void {
		const pixelRatio = Math.min(newDpr ?? window.devicePixelRatio ?? 1, 2);
		renderer.setPixelRatio(pixelRatio);
		renderer.setSize(w, h, false);
		composer.setPixelRatio(pixelRatio);
		composer.setSize(w, h);
	}

	function render(): void {
		renderer.clear();
		composer.render();
	}

	function dispose(): void {
		normalTex?.dispose();
		normalTex = null;
		inputTexture.dispose();
		quadMat.dispose();
		quad.geometry.dispose();
		composer.dispose();
		renderer.dispose();
	}

	return { syncInput, setUniforms, resize, render, dispose };
}

/**
 * Dawn/dusk factor from nightFactor — peaks at 1 at mid-transition
 * (nightFactor = 0.5), 0 at full day/full night. Small helper mirrored
 * from playground1 for consumers that want to drive uniforms.
 */
export function dawnDuskFrom(nightFactor: number): number {
	const nf = Math.max(0, Math.min(1, nightFactor));
	return 4 * nf * (1 - nf);
}
