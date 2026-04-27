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

		// --- Night composite mask ("overlay") ---
		// Cesium ImageryLayers alpha-blend; they cannot multiply. So at night the
		// dimmed-but-still-blue base imagery + dim CartoDB ocean leak a blue
		// neon-cast where VIIRS hasn't masked. Run a per-pixel "overlay mask"
		// here: pixels that are dim AND cool (high blue, low warmth) get
		// multiplied toward true black, while warm-or-bright pixels (VIIRS amber,
		// car-lights, road glow, sky) pass through.
		//
		//   coolness = how much the pixel leans blue vs. warm
		//   litness  = luminance × (1 + warmth)  — lit roads beat dim blue
		//
		// At u_nightFactor=1, dim+blue pixels approach 5% × original.
		float coolness = clamp(rgb.b - (rgb.r + rgb.g) * 0.5, 0.0, 1.0);
		float warmth = clamp((rgb.r - rgb.b), 0.0, 1.0);
		float litness = lum * (1.0 + warmth * 2.0);
		float overlayMask = (1.0 - smoothstep(0.05, 0.30, litness)) * (0.4 + coolness * 0.6);
		rgb *= mix(vec3(1.0), vec3(0.05, 0.05, 0.07), overlayMask * u_nightFactor);

		// --- Warm pollution corona ---
		// Additive haze on already-bright pixels post-overlay-crush. With cool
		// terrain killed above, smoothstep(0.20, 0.80) catches the surviving
		// VIIRS amber + car-light cores and softens them into a halo.
		float pollution = smoothstep(0.20, 0.80, lum) * u_nightFactor;
		rgb += vec3(0.20, 0.11, 0.03) * pollution * u_lightIntensity;

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
