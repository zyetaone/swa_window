/**
 * Post-process color grading shader.
 *
 * 4 jobs in render order:
 *
 *   1. lightMask    — `smoothstep(0.08, 0.5, lum)` catches bright VIIRS pixels.
 *   2. desat        — under lights, mix toward greyscale to prevent purple bleed.
 *   3. additive     — 3-stop warm palette (sodium → amber → warm-white).
 *   4. baseDark     — navy pull on unlit terrain, gated by (1 - lightMask).
 *   5. ambientFloor — prevents terrain from hitting pure black.
 *
 * Uniforms:
 *   u_nightFactor      0..1 darkness
 *   u_additiveStrength operator knob (config.world.additiveStrength)
 */

/**
 * Should the night post-FX pair (bloom + whichever grade is active) run?
 *
 * ─── WHY THIS IS NOT THE QUALITY GATE ───────────────────────────────────────
 * bloom and the grades used to ride `qualityMode !== 'performance'` alongside
 * shadows/FXAA/AO. The rationale was sound for daytime — every grade term is
 * multiplied by u_nightFactor, so by day the whole pass costs a full-screen
 * blit to produce an identity transform. But `performance` is the shipped Pi
 * default, so the gate also removed them at night, which is the one time they
 * ARE the look: bloom is the only source of spatial glow in the pipeline (the
 * grades' additive is per-pixel and cannot bleed into neighbours), and the
 * hash palette's ambient lift is what stops unlit terrain crushing to black.
 *
 * So gate on NIGHT, not on tier. Cost lands only where it buys something.
 *
 * Hysteresis (0.05 on / 0.02 off) because a bare threshold sits right where
 * nightFactor creeps across it at dusk, and the transition installs/removes a
 * post-process stage — cheap twice a day, not cheap every frame for a minute.
 */
export function nightPostFxOn(nightFactor: number, prev: boolean): boolean {
	return nightFactor >= (prev ? 0.02 : 0.05);
}

/**
 * Cesium postProcessStage name for the grade below. SSOT shared with
 * hash-palette.ts and NightVariantPanel for install/uninstall.
 */
export const COLOR_GRADE_STAGE = 'aero-color-grade';

export const COLOR_GRADING_GLSL = `
		uniform sampler2D colorTexture;
		uniform float u_nightFactor;
		uniform float u_additiveStrength;
		in vec2 v_textureCoordinates;

		void main() {
			vec4 color = texture(colorTexture, v_textureCoordinates);

			// Uniform-driven early-exit — no GPU stall (all fragments take same path).
			if (u_nightFactor < 0.001) {
				out_FragColor = color;
				return;
			}

			vec3 rgb = color.rgb;
			float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

			// 1. lightMask — gates warm additive paths to bright pixels only.
			float lightMask = smoothstep(0.15, 0.5, lum);

			// 2. Desat under lights — kill blue-base/amber-light → purple bleed.
			vec3 grayBase = vec3(lum);
			rgb = mix(rgb, grayBase, lightMask * 0.4 * u_nightFactor);

			// 3. BASE DARKENING — pull unlit terrain toward deep navy.
			//    Gated by (1 - lightMask) so city lights survive.
			vec3 deepNavy = vec3(0.022, 0.025, 0.030);
			float baseDark = smoothstep(0.55, 0.92, u_nightFactor) * 0.40 * (1.0 - lightMask);
			rgb = mix(rgb, deepNavy, baseDark);

			// 4. 3-stop warm palette (sodium → amber → warm-white).
			vec3 sodium  = vec3(1.0, 0.6, 0.2);
			vec3 amber   = vec3(1.0, 0.8, 0.4);
			vec3 warmWht = vec3(1.0, 0.88, 0.72);

			vec3 lightColor = mix(sodium, amber, smoothstep(0.2, 0.6, lum));
			lightColor = mix(lightColor, warmWht, smoothstep(0.78, 1.0, lum));

			rgb += lightColor * lum * lightMask * u_additiveStrength * u_nightFactor;

			// 5. Ambient floor — one mechanism to keep terrain visible at night.
			rgb = max(rgb, vec3(0.080, 0.070, 0.055) * u_nightFactor);

			out_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
		}
	`;
