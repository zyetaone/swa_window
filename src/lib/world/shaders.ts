/**
 * Post-process color grading shader.
 *
 * Pixel-level finishing pass that runs after Cesium has composited the
 * imagery layers + bloom. Three jobs:
 *
 *   1. brightGuard — protect sun disc / specular highlights from crush
 *   2. pollution   — subtle warm corona on already-bright pixels at night
 *   3. shadowCrush + contrast — push the dark end darker at night for pop
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

		// Preserve sun disc + specular highlights from night crush below.
		float brightGuard = smoothstep(0.75, 0.95, lum);

		// Subtle warm pollution corona on already-bright (post-composite)
		// pixels — the atmospheric halo around dense cities seen from altitude.
		float pollution = smoothstep(0.35, 0.9, lum) * u_nightFactor;
		rgb += vec3(0.15, 0.08, 0.02) * pollution * u_lightIntensity;

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
