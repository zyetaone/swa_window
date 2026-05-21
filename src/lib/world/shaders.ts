/**
 * Post-process color grading shader.
 *
 * Pixel-level finishing pass that runs after Cesium has composited the
 * imagery layers + bloom. Three jobs (Phase 15.5 P2 simplification):
 *
 *   1. brightGuard — protect VIIRS amber + sun disc from base darkening
 *   2. baseDarken  — replaces the CartoDB Dark imagery overlay's
 *                    atmospheric function with a 3-line mix() to navy.
 *                    Smoothstep(0.45, 0.9) matches the old CartoDB
 *                    ramp so the blue-hour beat survives.
 *   3. pollution   — subtle warm corona on already-bright pixels at night
 *
 * What this shader USED to do but no longer does (and why):
 *   - shadow crush + contrast → 90% redundant with Cesium's HDR tonemap
 *                                and bloom. The base mix() already pushes
 *                                darks toward navy; pow()-based crush on
 *                                top compounded the darkening without
 *                                adding legibility. Dropped in Phase 15.5
 *                                per council (game-dev + exp-dev voices).
 *   - horizon haze       → painted by `scene/effects/haze/HazeEffect.svelte`
 *                          via `mix-blend-mode: screen` on the DOM, palette
 *                          driven from `$content/palettes/sky.ts`. Single
 *                          source of horizon haze.
 *   - dawn/dusk rim      → Cesium's own `skyAtmosphere` carries the warm
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

		// Preserve VIIRS amber + sun disc from base darkening below.
		float brightGuard = smoothstep(0.75, 0.95, lum);

		// Base darkening — replaces the (removed) CartoDB Dark imagery
		// overlay. Smoothstep(0.45, 0.9) matches the old CartoDB ramp so
		// the "atmospheric darkening starts before city lights" blue-hour
		// beat survives. Navy tint reads deep-blue-dark, not pure black —
		// the unlit ground feels atmospheric, not void.
		float darkenAmount = smoothstep(0.45, 0.9, u_nightFactor) * 0.85;
		rgb = mix(rgb, vec3(0.02, 0.04, 0.08), darkenAmount * (1.0 - brightGuard));

		// Subtle warm pollution corona on already-bright pixels — the
		// atmospheric halo around dense cities seen from altitude. Clamp
		// prevents additive blow-out at high u_lightIntensity on already-
		// bloomed city cores (otherwise hue-shifts yellow once a channel
		// saturates).
		float pollution = smoothstep(0.35, 0.9, lum) * u_nightFactor;
		rgb = min(rgb + vec3(0.15, 0.08, 0.02) * pollution * u_lightIntensity, vec3(1.0));

		out_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
	}
`;
