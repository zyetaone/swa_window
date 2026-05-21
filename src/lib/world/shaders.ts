/**
 * Post-process color grading shader.
 *
 * Pixel-level finishing pass that runs after Cesium has composited the
 * imagery layers + bloom. Four jobs (Phase 15.5 P2 simplification):
 *
 *   1. baseDarken  — sky/ocean/ground push toward navy-dark at night.
 *                    Replaces the CartoDB Dark imagery layer's atmospheric
 *                    function with a 3-line shader mix(). Gated by
 *                    brightGuard so VIIRS amber + sky stars survive.
 *   2. brightGuard — protect sun disc / specular highlights from crush
 *   3. pollution   — subtle warm corona on already-bright pixels at night
 *   4. shadowCrush + contrast — push the dark end darker at night for pop
 *
 * What this shader does NOT do (and why):
 *   - Horizon haze       → painted by `scene/effects/haze/HazeEffect.svelte`
 *                          via `mix-blend-mode: screen` on the DOM, palette
 *                          driven from `$content/palettes/sky.ts`. Single
 *                          source of horizon haze.
 *   - Dawn/dusk rim      → Cesium's own `skyAtmosphere` carries the warm
 *                          horizon glow at sunrise/sunset (sun-position
 *                          dependent). The shader's earlier "warm from left
 *                          edge" approximation didn't match the real sun
 *                          direction at our -75° camera pitch, and stacked
 *                          on top of skyAtmosphere produced the cyan band.
 */

export const COLOR_GRADING_GLSL = `
	uniform sampler2D colorTexture;
	uniform float u_nightFactor;
	uniform float u_lightIntensity;
	in vec2 v_textureCoordinates;

	void main() {
		vec4 color = texture(colorTexture, v_textureCoordinates);
		vec3 rgb = color.rgb;
		float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

		// Preserve sun disc + specular highlights from night crush + base darkening.
		float brightGuard = smoothstep(0.75, 0.95, lum);

		// Base darkening — replaces CartoDB Dark imagery overlay with shader
		// math. Smoothstep(0.45, 0.9) matches the old NIGHT_MAP_SMOOTHSTEP
		// curve so the "atmospheric darkening starts before city lights"
		// blue-hour beat survives. brightGuard keeps VIIRS amber cores + sun
		// disc + bloom halos un-darkened. Navy tint reads as deep-blue-dark,
		// not pure black — keeps the unlit ground atmospheric, not void.
		float darkenAmount = smoothstep(0.45, 0.9, u_nightFactor) * 0.85;
		rgb = mix(rgb, vec3(0.02, 0.04, 0.08), darkenAmount * (1.0 - brightGuard));

		// Subtle warm pollution corona on already-bright (post-composite)
		// pixels — the atmospheric halo around dense cities seen from altitude.
		// Clamped to vec3(1.0) to prevent additive blow-out at high
		// u_lightIntensity (>1.0) on already-bright bloomed city cores, which
		// would otherwise hue-shift toward yellow once one channel saturated.
		float pollution = smoothstep(0.35, 0.9, lum) * u_nightFactor;
		rgb = min(rgb + vec3(0.15, 0.08, 0.02) * pollution * u_lightIntensity, vec3(1.0));

		// Shadow crush at night. max(0) guards against NaN from pow() on
		// negative HDR values; brightGuard keeps the sun out of the crush.
		float shadowCrush = 1.0 - (0.4 * u_nightFactor * (1.0 - brightGuard));
		rgb = pow(max(rgb, vec3(0.0)), vec3(1.0 / shadowCrush));

		// Contrast boost at night, attenuated for bright pixels.
		float contrast = 1.0 + (0.3 * u_nightFactor * (1.0 - brightGuard));
		rgb = (rgb - 0.5) * contrast + 0.5;

		out_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
	}
`;
