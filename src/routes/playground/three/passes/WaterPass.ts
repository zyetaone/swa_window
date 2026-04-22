/**
 * WaterPass — Three.js ShaderPass that re-paints water pixels in the
 * composed frame with a Cesium-style animated water look.
 *
 * Pipeline position (see post-composer.svelte.ts):
 *   RenderPass → ColorGradePass → UnrealBloomPass → **WaterPass** →
 *   OutputPass
 *
 * Why AFTER bloom: water shouldn't smear city-light bloom halos. By
 * running after bloom, we replace the water pixels outright (masked by
 * a chroma-key), leaving land + bloom halos intact.
 *
 * Water mask strategy: **C — chroma-key**. We pass the live water base
 * color (from playground/lib/sun-palette.svelte) as a uniform, and the
 * shader detects water pixels by Euclidean RGB distance. A second
 * MapLibre instance (Strategy A) was considered but rejected: doubles
 * texture memory + adds a second per-frame ml → canvas → texImage2D
 * upload, and the water color is already known precisely from the
 * palette (so the chroma-key isn't a fragile heuristic — it's sampling
 * against ground truth). Fringe cases (shadow over water, building
 * overlaps) are handled by smooth-edged mask + tolerance tuning.
 *
 * Normal map: Cesium's waterNormalsSmall.jpg, Apache 2.0. Bundled to
 * /static/textures/water-normals.jpg at commit time.
 */

import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import waterFrag from '../shaders/water.glsl?raw';

/** Uniform values updated per-frame by the controller. */
export type WaterUniforms = {
	nightFactor: number;
	dawnDuskFactor: number;
	/** RGB 0-1 — the palette's water color this frame. */
	waterBase: THREE.Vector3Tuple;
	/** Chroma-key tolerance. Smaller = tighter. 0.18 is a good default. */
	waterKeyTolerance?: number;
	/** Screen-space sun direction (x:horiz, y:vert, z:alt above horizon). */
	sunDirScreen: THREE.Vector3Tuple;
	/** Sun disc color, RGB 0-1. */
	sunColor: THREE.Vector3Tuple;
	/** Color water reflects back from the sky at grazing angles (palette). */
	skyReflection: THREE.Vector3Tuple;
	/** Effect master — 0 disables, 1 full. Lets us fade in on mount. */
	waterIntensity?: number;
	/** Monotonic seconds — for scrolling normal map animation. */
	time: number;
};

const DEFAULT_TOLERANCE = 0.18;

// The vertex shader is the stock ShaderPass fullscreen-triangle vert;
// we keep it inline because ShaderPass requires the shader object to
// define both vertex + fragment.
export const WaterShader = {
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
		u_waterIntensity:    { value: 1 },
		u_time:              { value: 0 },
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: waterFrag,
};

export interface WaterPassHandle {
	pass: ShaderPass;
	/** Swap in a loaded normal-map texture (call once after load). */
	setNormalMap(tex: THREE.Texture): void;
	/** Push live uniform values this frame. */
	setUniforms(u: WaterUniforms): void;
	/** Dispose the normal-map texture (pass itself is disposed by composer). */
	dispose(): void;
}

/**
 * Build a WaterPass. The normal-map texture is lazily loaded — the
 * pass renders as a no-op (u_waterIntensity forced to 0) until the
 * texture is ready, so there's no first-frame flicker.
 */
export function createWaterPass(normalMapUrl = '/textures/water-normals.jpg'): WaterPassHandle {
	const pass = new ShaderPass(WaterShader);

	// Until the texture loads, force intensity to 0 (cheap early-out in
	// the fragment shader keeps this near-free).
	pass.uniforms.u_waterIntensity.value = 0;

	const loader = new THREE.TextureLoader();
	let loadedTex: THREE.Texture | null = null;

	loader.load(
		normalMapUrl,
		(tex) => {
			tex.wrapS = THREE.RepeatWrapping;
			tex.wrapT = THREE.RepeatWrapping;
			tex.minFilter = THREE.LinearMipmapLinearFilter;
			tex.magFilter = THREE.LinearFilter;
			tex.generateMipmaps = true;
			// Color-space: this is a data texture (normals), not color. Three
			// r152+ defaults textures to sRGB; force linear.
			tex.colorSpace = THREE.NoColorSpace;
			tex.anisotropy = 4;
			loadedTex = tex;
			pass.uniforms.tWaterNormals.value = tex;
			pass.uniforms.u_waterIntensity.value = 0.35;
		},
		undefined,
		(err) => {
			// Silent-fail: missing texture just means no water effect. Keeps
			// the playground alive on build-time path hiccups.
			// eslint-disable-next-line no-console
			console.warn('[WaterPass] normal map failed to load', err);
		},
	);

	function setNormalMap(tex: THREE.Texture): void {
		loadedTex = tex;
		pass.uniforms.tWaterNormals.value = tex;
		pass.uniforms.u_waterIntensity.value = 0.35;
	}

	function setUniforms(u: WaterUniforms): void {
		const uf = pass.uniforms;
		uf.u_nightFactor.value = u.nightFactor;
		uf.u_dawnDuskFactor.value = u.dawnDuskFactor;
		uf.u_time.value = u.time;
		if (u.waterKeyTolerance != null) uf.u_waterKeyTolerance.value = u.waterKeyTolerance;
		// Only override the texture-gated intensity once it's ≥0. The
		// loader flips it to 1 when ready; we then track caller's value.
		if (loadedTex && u.waterIntensity != null) {
			uf.u_waterIntensity.value = u.waterIntensity;
		}
		(uf.u_waterBase.value as THREE.Vector3).fromArray(u.waterBase);
		(uf.u_sunDirScreen.value as THREE.Vector3).fromArray(u.sunDirScreen);
		(uf.u_sunColor.value as THREE.Vector3).fromArray(u.sunColor);
		(uf.u_skyReflection.value as THREE.Vector3).fromArray(u.skyReflection);
	}

	function dispose(): void {
		loadedTex?.dispose();
		loadedTex = null;
	}

	return { pass, setNormalMap, setUniforms, dispose };
}
