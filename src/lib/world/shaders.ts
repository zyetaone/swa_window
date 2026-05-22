/**
 * Post-process color grading shader.
 *
 * Restored from Feb 15 (commit 4697680:src/lib/layers/cesium-shaders.ts) +
 * 4 Phase-16/17 lessons (ACES tonemap in compose.ts, immediate tick after
 * mount, lifted ambient floor, additive strength is operator-tunable).
 *
 * Five jobs in render order:
 *
 *   1. lightMask    — `smoothstep(0.12, 0.5, lum)` catches bright VIIRS-lit
 *                     pixels + CartoDB road geometry.
 *   2. desat        — under lights, mix toward greyscale so the underlying
 *                     blue atmosphere/ground doesn't tint amber → purple.
 *   3. additive     — 3-stop warm palette (sodium → amber → warm-white)
 *                     ADDED to the scene per `lum * u_additiveStrength`.
 *   4. pollution    — subtle warm haze on already-bright pixels.
 *   5. crush        — gamma shadow crush + contrast bump at night.
 *
 * The 7-job version this replaces (Phase 9-16) had chroma gating,
 * dark-void crush, aerial perspective lerp, hash palette variance, and
 * ambient floor. Dropped per user direction ("simplify much further") —
 * the Feb 15 night look came from layer composition (3 imagery layers +
 * procedural building emissive), not from shader complexity.
 *
 * Uniforms (was 9, now 3):
 *   u_nightFactor      0..1 darkness
 *   u_lightIntensity   operator knob (config.world.nightLightIntensity)
 *   u_additiveStrength operator knob (config.world.additiveStrength)
 */

export const COLOR_GRADING_GLSL = `
	uniform sampler2D colorTexture;
	uniform float u_nightFactor;
	uniform float u_lightIntensity;
	uniform float u_additiveStrength;
	in vec2 v_textureCoordinates;

	void main() {
		vec4 color = texture(colorTexture, v_textureCoordinates);
		vec3 rgb = color.rgb;
		float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

		// 1. lightMask — bright pixels only (VIIRS amber + CartoDB road
		//    lines + building emissive).
		float lightMask = smoothstep(0.12, 0.5, lum);

		// 2. Desat under lights — kill blue-base/amber-light → purple bleed.
		vec3 grayBase = vec3(lum);
		rgb = mix(rgb, grayBase, lightMask * 0.8 * u_nightFactor);

		// 3. 3-stop warm palette (sodium → amber → warm-white). Calm-amber
		//    brand. Additive blend so lights ADD on top of the desaturated
		//    terrain.
		vec3 sodium  = vec3(1.0, 0.6, 0.2);
		vec3 amber   = vec3(1.0, 0.8, 0.4);
		vec3 warmWht = vec3(1.0, 0.95, 0.85);

		vec3 lightColor = mix(sodium, amber, smoothstep(0.2, 0.6, lum));
		lightColor = mix(lightColor, warmWht, smoothstep(0.6, 1.0, lum));

		rgb += lightColor * lum * u_additiveStrength * u_nightFactor;

		// 4. Soft pollution corona — subtle warm haze near bright sources.
		float pollution = smoothstep(0.25, 0.6, lum) * u_nightFactor;
		rgb += vec3(0.12, 0.06, 0.01) * pollution * u_lightIntensity;

		// 5. Shadow crush + contrast bump at night so cities pop.
		float shadowCrush = 1.0 - 0.35 * u_nightFactor;
		rgb = pow(max(rgb, 0.0), vec3(1.0 / shadowCrush));
		float contrast = 1.0 + 0.25 * u_nightFactor;
		rgb = (rgb - 0.5) * contrast + 0.5;

		out_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
	}
`;
