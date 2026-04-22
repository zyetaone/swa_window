/**
 * ColorGradePass — Three.js ShaderPass wrapping the SWA night color-grade.
 *
 * Ported from Cesium prod's PostProcessStage in src/lib/world/shaders.ts.
 * Runs AFTER MapLibre composites a frame (input = MapLibre canvas as
 * texture, fed via the copyTexture feed in PostProcessMount), and BEFORE
 * UnrealBloomPass (so city lights already carry palette variance and
 * pollution corona when bloom widens them into halos).
 *
 * Uniforms are simple numbers — wired live from sky-phase.ts equivalents
 * via the post-composer controller, not via getter closures (Three.js
 * ShaderPass doesn't evaluate function uniforms).
 */

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import nightGradeFrag from '../shaders/night-grade.glsl?raw';

/**
 * THREE.Shader-shaped object consumed by ShaderPass. The vertex shader
 * is the stock ShaderPass fullscreen-triangle vert; only fragment +
 * uniforms are ours.
 */
export const ColorGradeShader = {
	uniforms: {
		tDiffuse: { value: null },
		u_nightFactor: { value: 0 },
		u_dawnDuskFactor: { value: 0 },
		u_lightIntensity: { value: 1 },
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: nightGradeFrag,
};

export function createColorGradePass(): ShaderPass {
	return new ShaderPass(ColorGradeShader);
}

export type ColorGradeUniforms = {
	nightFactor: number;
	dawnDuskFactor: number;
	lightIntensity: number;
};

/** Push live values into a pass's uniforms. Call each frame. */
export function updateColorGradeUniforms(pass: ShaderPass, u: ColorGradeUniforms): void {
	pass.uniforms.u_nightFactor.value = u.nightFactor;
	pass.uniforms.u_dawnDuskFactor.value = u.dawnDuskFactor;
	pass.uniforms.u_lightIntensity.value = u.lightIntensity;
}
