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
		// night crush effects. Without this, pow() shadow crush can turn the sun
		// into a black dot (negative HDR values → NaN, or bright values get crushed).
		float brightGuard = smoothstep(0.75, 0.95, lum);

		// --- Night City Light Coloring ---
		// Threshold raised so dim terrain stays neutral — only actual lights get warm tint
		float lightMask = smoothstep(0.12, 0.5, lum);

		// Desaturate the base world color where lights are present
		// This prevents the underlying blue atmosphere/ground from turning orange lights into purple/mud
		vec3 grayBase = vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
		rgb = mix(rgb, grayBase, lightMask * 0.8 * u_nightFactor);

		// City Light Palette (mixed lighting types)
		vec3 sodium   = vec3(1.0, 0.6, 0.2);     // Deep Orange (sodium vapor)
		vec3 amber    = vec3(1.0, 0.8, 0.4);     // Amber/Gold (halogen)
		vec3 warmWht  = vec3(1.0, 0.95, 0.9);    // Warm White (incandescent)
		vec3 coolWht  = vec3(0.85, 0.92, 1.0);   // Cool White (LED/fluorescent)
		vec3 blueWht  = vec3(0.75, 0.85, 1.0);   // Blue-White (modern LED)

		// Luminance-based palette: dim outskirts = sodium, mid = amber/warm,
		// bright centers = cool white, brightest = blue-white LED
		vec3 lightColor = mix(sodium, amber, smoothstep(0.15, 0.4, lum));
		lightColor = mix(lightColor, warmWht, smoothstep(0.4, 0.65, lum));
		lightColor = mix(lightColor, coolWht, smoothstep(0.65, 0.85, lum));
		lightColor = mix(lightColor, blueWht, smoothstep(0.85, 1.0, lum));

		// Additive blending for lights (emissive feel, reduced multiplier to prevent wash-out)
		rgb += lightColor * lum * 2.0 * u_nightFactor;

		// --- Dark Void Crush ---
		// Tame the shadow crush — keep terrain visible at night.
		// 0.3 instead of 0.7 means dim terrain loses ~30% brightness instead of 70%.
		// Lit city areas survive fine; rural terrain stays legible.
		float darkVoid = 1.0 - smoothstep(0.05, 0.2, lum);
		rgb = mix(rgb, vec3(0.0), darkVoid * u_nightFactor * 0.3 * (1.0 - brightGuard));

		// Light pollution glow (subtle warm haze — only near bright sources)
		float pollution = smoothstep(0.25, 0.6, lum) * u_nightFactor;
		rgb += vec3(0.12, 0.06, 0.01) * pollution * u_lightIntensity;

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
