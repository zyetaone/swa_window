/**
 * GLSL Shaders for CesiumViewer
 *
 * Color grading post-process for night city light rendering.
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

		// --- Night City Light Coloring ---
		// Threshold raised so dim terrain stays neutral — only actual lights get warm tint
		float lightMask = smoothstep(0.12, 0.5, lum);

		// Desaturate the base world color where lights are present
		// This prevents the underlying blue atmosphere/ground from turning orange lights into purple/mud
		vec3 grayBase = vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
		rgb = mix(rgb, grayBase, lightMask * 0.8 * u_nightFactor);

		// Sodium Vapor Palette (Warm/Industrial)
		vec3 sodium = vec3(1.0, 0.6, 0.2);     // Deep Orange
		vec3 amber  = vec3(1.0, 0.8, 0.4);     // Amber/Gold
		vec3 white  = vec3(1.0, 0.95, 0.9);    // Warm White

		// Simple distinct regions based on luminance intensity
		// (Brighter centers = white/amber, dimmer outskirts = sodium orange)
		vec3 lightColor = mix(sodium, amber, smoothstep(0.2, 0.6, lum));
		lightColor = mix(lightColor, white, smoothstep(0.6, 1.0, lum));

		// Additive blending for lights (emissive feel)
		// We add the light color on top of the darkened/desaturated terrain
		rgb += lightColor * lum * 2.5 * u_nightFactor;

		// Light pollution glow (subtle warm haze — only near bright sources)
		float pollution = smoothstep(0.25, 0.6, lum) * u_nightFactor;
		rgb += vec3(0.12, 0.06, 0.01) * pollution * u_lightIntensity;

		// Crush shadows
		float shadowCrush = 1.0 - (0.4 * u_nightFactor);
		rgb = pow(rgb, vec3(1.0 / shadowCrush));

		// High Contrast
		float contrast = 1.0 + (0.3 * u_nightFactor);
		rgb = (rgb - 0.5) * contrast + 0.5;

		out_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
	}
`;
