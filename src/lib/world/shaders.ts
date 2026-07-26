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

/**
 * Cesium postProcessStage name for the grade below.
 *
 * SSOT because it is an identity string, not a label: compose.ts registers
 * the stage under it, while hash-palette.ts and NightVariantPanel look the
 * stage UP by it in order to disable it before installing their own. Rename
 * it in one place only and both lookups quietly match nothing — the grade
 * stays enabled and double-applies under the replacement.
 */
export const COLOR_GRADE_STAGE = 'aero-color-grade';

export const COLOR_GRADING_GLSL = `
	uniform sampler2D colorTexture;
	uniform float u_nightFactor;
	uniform float u_additiveStrength;
	in vec2 v_textureCoordinates;

	void main() {
		vec4 color = texture(colorTexture, v_textureCoordinates);

		// Uniform-driven early-exit. At day (u_nightFactor=0) every step
		// below is mathematically identity: the additive paths multiply by
		// nightFactor=0 (skipped), shadowCrush=1.0 makes pow() identity, and
		// the contrast bump is 1.0× (also identity). Since u_nightFactor is
		// a UNIFORM (same value across all fragments per frame), this branch
		// is divergence-free — the entire wavefront takes the same path,
		// no GPU stall cost. Saves ~10 ops/pixel + a pow() for the ~12
		// daytime hours of every kiosk day.
		if (u_nightFactor < 0.001) {
			out_FragColor = color;
			return;
		}

		vec3 rgb = color.rgb;
		float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

		// 1. lightMask — gates the warm additive paths below. Floor lowered
		//    from 0.12 → 0.08 so mid-bright VIIRS suburbs and dim CartoDB
		//    arterials catch the warmth too (was missing the city extent).
		float lightMask = smoothstep(0.08, 0.5, lum);

		// 2. Desat under lights — kill blue-base/amber-light → purple bleed.
		vec3 grayBase = vec3(lum);
		rgb = mix(rgb, grayBase, lightMask * 0.8 * u_nightFactor);

		// 2b. BASE DARKENING (Phase 15.5 contract — restored). Pull the unlit
		//     terrain / open water / residual sky toward deep navy as night
		//     falls. This is load-bearing: compose.ts:syncImagery DELIBERATELY
		//     no longer dims baseLayer.brightness (stays 1.0) because it relies
		//     on THIS mix to darken the scene — the contract was silently broken
		//     when the shader was reverted to the Feb-15 base, leaving the bright
		//     EOX ocean to get gold-tinted by the additive below (the "gold
		//     night" bug). Gated by (1 - lightMask) so genuine city lights
		//     survive and still take the warm additive in step 3.
		vec3 deepNavy = vec3(0.012, 0.022, 0.045);
		// Ramp start 0.45 → 0.55 (evening recalibration): the navy pull was
		// already 20% engaged by 19:00 (nf 0.58), crushing what little dusk
		// signal the scene has into black an hour early. Starting later keeps
		// the evening band present; the nf=1.0 deep-night value (0.85) is
		// unchanged, so the load-bearing night-ground contract holds.
		float baseDark = smoothstep(0.55, 0.92, u_nightFactor) * 0.85 * (1.0 - lightMask);
		rgb = mix(rgb, deepNavy, baseDark);

		// 3. 3-stop warm palette (sodium → amber → warm-white). Calm-amber
		//    brand. Additive blend so lights ADD on top of the desaturated
		//    terrain. CRITICAL: gated by lightMask — without this, dim
		//    sky pixels (lum ~0.03-0.05 after brightnessShift) pick up a
		//    warm tint from lightColor x lum x 6.0 and the night sky
		//    reads brown/amber instead of black. desat (above) and
		//    pollution (below) were already lightMask-gated; this line
		//    was the lone exception and is the deep "bright sky" bug.
		vec3 sodium  = vec3(1.0, 0.6, 0.2);
		vec3 amber   = vec3(1.0, 0.8, 0.4);
		vec3 warmWht = vec3(1.0, 0.88, 0.72);

		vec3 lightColor = mix(sodium, amber, smoothstep(0.2, 0.6, lum));
		// warm-white stop pushed 0.6 → 0.78 (and the white itself warmed):
		// highway cores were blowing to pure white under additive×bloom,
		// splitting the city into "white roads vs amber blocks". Holding
		// amber longer keeps one coherent sodium identity; only the very
		// brightest CBD pixels reach warm-white now.
		lightColor = mix(lightColor, warmWht, smoothstep(0.78, 1.0, lum));

		rgb += lightColor * lum * lightMask * u_additiveStrength * u_nightFactor;

		// (Pollution corona removed — it doubled the halo the EffectStack bloom
		// already produces over the same bright core, feeding the over-bright
		// central dome. Bloom now owns the glow halo entirely. u_lightIntensity
		// still drives the building-window shader; only this corona is gone.)

		// 4. Shadow crush + contrast bump at night so cities pop. Crush
		//    softened (0.35 → 0.2) so suburb mid-tones survive — too-deep
		//    crush collapsed the city silhouette into the sky.
		float shadowCrush = 1.0 - 0.20 * u_nightFactor;
		rgb = pow(max(rgb, 0.0), vec3(1.0 / shadowCrush));
		// 0.25 → 0.16: full-strength contrast at deep night double-crushed
		// the suburb mid-tones (pitch-black gaps between lit blocks) while
		// pushing the already-additive road cores further toward clip. A
		// gentler bump keeps the city "pop" without the Tron look.
		float contrast = 1.0 + 0.16 * u_nightFactor;
		rgb = (rgb - 0.5) * contrast + 0.5;

		out_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
	}
`;
