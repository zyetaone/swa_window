/**
 * GLSL Shaders for CesiumViewer
 *
 * Color grading post-process for night city light rendering.
 * Includes: sodium vapor city lights, dark void crush,
 * horizon atmospheric haze, dawn/dusk directional rim light.
 */

// ========================================================================
// Environmental color grading post-process
// ========================================================================

export const COLOR_GRADING_GLSL = `
	uniform sampler2D colorTexture;
	uniform float u_nightFactor;
	uniform float u_dawnDuskFactor;
	uniform float u_lightIntensity;
	in vec2 v_textureCoordinates;

	void main() {
		vec4 color = texture(colorTexture, v_textureCoordinates);
		vec3 rgb = color.rgb;
		float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

		// --- Bright Pixel Guard ---
		// Preserve sun disc, bright sky highlights, and specular reflections from
		// night crush effects.
		float brightGuard = smoothstep(0.75, 0.95, lum);

		// --- Night City Light Coloring ---
		// Widened falloff (0.08 → 0.65): shallower ramp lets pixels between lit
		// roads pick up 20-30% of warm treatment, reading perceptually as spill.
		float lightMask = smoothstep(0.08, 0.65, lum);

		// Desaturate base world color where lights are present so the underlying
		// blue atmosphere doesn't turn orange lights into purple/mud.
		vec3 grayBase = vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
		rgb = mix(rgb, grayBase, lightMask * 0.8 * u_nightFactor);

		// --- Per-pixel palette variance ---
		// Hash from screen UV — shifts each pixel's effective luminance for
		// palette lookup by ±0.15 so neighbouring pixels resolve into different
		// palette buckets even if they share luminance. Breaks the flat-amber
		// look of the previous version.
		float hash = fract(sin(dot(v_textureCoordinates * 1000.0, vec2(12.9898, 78.233))) * 43758.5453);
		// Tightened from 0.30 → 0.16 so palette buckets don't swing wildly.
		// Wide swings + bloom sigma were spreading purple/blue onto ocean +
		// terrain. Narrower range keeps variance subtle but visible.
		float paletteLum = clamp(lum + (hash - 0.5) * 0.16, 0.0, 1.0);

		// City Light Palette (mixed lighting types)
		vec3 sodium   = vec3(1.0, 0.6, 0.2);     // Deep Orange (sodium vapor)
		vec3 amber    = vec3(1.0, 0.8, 0.4);     // Amber/Gold (halogen)
		vec3 warmWht  = vec3(1.0, 0.95, 0.9);    // Warm White (incandescent)
		vec3 coolWht  = vec3(0.85, 0.92, 1.0);   // Cool White (LED/fluorescent)
		vec3 blueWht  = vec3(0.75, 0.85, 1.0);   // Blue-White (modern LED)
		vec3 trafficRed = vec3(1.0, 0.15, 0.05); // Traffic/beacon sparks

		// Luminance-based palette — using the hashed paletteLum so each pixel
		// independently lands in a different bucket.
		vec3 lightColor = mix(sodium, amber, smoothstep(0.15, 0.4, paletteLum));
		lightColor = mix(lightColor, warmWht, smoothstep(0.4, 0.65, paletteLum));
		lightColor = mix(lightColor, coolWht, smoothstep(0.65, 0.85, paletteLum));
		lightColor = mix(lightColor, blueWht, smoothstep(0.85, 1.0, paletteLum));

		// Sparse red-spark layer — ~2% of lit pixels mix toward traffic red.
		// Reduced from step(0.97, …) and amplitude 0.8 → 0.3 because combined
		// with bloom sigma it was creating visible RED BLOBS on bright ocean /
		// coastline (Palm Jumeirah). Accent-only intent, not a feature.
		float redSpark = step(0.98, fract(hash * 7.3));
		lightColor = mix(lightColor, trafficRed, redSpark * lightMask * 0.3);

		// Additive blending — multiplier raised from 1.0 → 1.6 for emissive feel.
		// Clamp to 2.0 so downstream pow() shadow crush doesn't turn blown-out
		// district centers into grey-white.
		rgb += lightColor * lum * 1.6 * u_nightFactor;
		rgb = min(rgb, vec3(2.0));

		// --- Dark Void Crush ---
		// Keep terrain visible at night — dim terrain loses ~30% brightness.
		float darkVoid = 1.0 - smoothstep(0.05, 0.2, lum);
		rgb = mix(rgb, vec3(0.0), darkVoid * u_nightFactor * 0.3 * (1.0 - brightGuard));

		// --- Light pollution corona ---
		// Broadened footprint (0.10 → 0.5) with slightly warmer tint so cities
		// accumulate a visible amber dome from altitude. Rural stays unaffected.
		float pollution = smoothstep(0.10, 0.5, lum) * u_nightFactor;
		rgb += vec3(0.18, 0.09, 0.02) * pollution * u_lightIntensity;

		// Crush shadows — max(0) prevents NaN from pow() on negative HDR values
		// Reduce crush effect on bright pixels (sun, specular) via brightGuard
		float shadowCrush = 1.0 - (0.4 * u_nightFactor * (1.0 - brightGuard));
		rgb = pow(max(rgb, vec3(0.0)), vec3(1.0 / shadowCrush));

		// High Contrast — reduced for bright pixels to preserve sun/sky
		float contrast = 1.0 + (0.3 * u_nightFactor * (1.0 - brightGuard));
		rgb = (rgb - 0.5) * contrast + 0.5;

		// --- Horizon Atmospheric Haze ---
		// The defining visual of aerial photography: a pale band where the
		// atmosphere is thickest, sitting at the horizon line (~35% from top).
		// Fades to warm amber at dawn/dusk, invisible at night.
		float horizonY = 0.35;
		float horizonBand = 1.0 - abs(v_textureCoordinates.y - horizonY) / 0.2;
		horizonBand = clamp(horizonBand, 0.0, 1.0);
		vec3 hazeColor = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.8, 0.5), u_dawnDuskFactor);
		rgb = mix(rgb, hazeColor, horizonBand * 0.15 * (1.0 - u_nightFactor));

		// --- Dawn/Dusk Directional Rim Light ---
		// Simulates the sun rising/setting from one side. The left edge of the
		// frame gets a warm gold wash, fading across the viewport. Only active
		// during dawn/dusk transitions (dawnDuskFactor > 0).
		float rimX = 1.0 - v_textureCoordinates.x;  // left edge = brightest
		float rimLight = rimX * u_dawnDuskFactor * 0.25;
		vec3 warmRim = vec3(1.0, 0.7, 0.3) * rimLight;
		rgb += warmRim * (1.0 - u_nightFactor);

		out_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
	}
`;
