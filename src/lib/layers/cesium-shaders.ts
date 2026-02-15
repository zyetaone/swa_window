/**
 * GLSL Shaders for CesiumViewer
 *
 * Extracted from CesiumViewer.svelte to reduce component size.
 * Contains: building night shader, color grading, selective bloom pipeline.
 */

// ========================================================================
// Enhanced building shader — procedural lit windows, street glow, aviation lights
// ========================================================================

export const BUILDING_SHADER_GLSL = `
	void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
		vec3 normal = normalize(fsInput.attributes.normalMC);

		// Surface orientation detection
		float upDot = abs(dot(normal, vec3(0.0, 0.0, 1.0)));
		float isWall = smoothstep(0.3, 0.7, 1.0 - upDot);
		float isRoof = smoothstep(0.7, 0.9, upDot);

		vec3 wp = fsInput.attributes.positionMC;
		float buildingHeight = wp.z;
		float floorHeight = 3.0;
		float floorIndex = floor(wp.z / floorHeight);
		float isGroundFloor = step(floorIndex, 0.5);

		// Height-based window density: taller buildings = more lit (office towers)
		float heightFactor = smoothstep(10.0, 80.0, buildingHeight);
		float adjustedDensity = mix(u_windowDensity * 0.4, u_windowDensity * 1.3, heightFactor);

		// Window grid pattern
		float windowWidth = mix(0.55, 0.8, isGroundFloor);
		float windowHeight = mix(0.65, 0.85, isGroundFloor);
		vec2 gridUV = fract(vec2(wp.x * 0.12, wp.z / floorHeight));
		float windowX = smoothstep(0.5 - windowWidth * 0.5, 0.5 - windowWidth * 0.5 + 0.05, gridUV.x)
		             * smoothstep(0.5 + windowWidth * 0.5, 0.5 + windowWidth * 0.5 - 0.05, gridUV.x);
		float windowY = smoothstep(0.5 - windowHeight * 0.5, 0.5 - windowHeight * 0.5 + 0.05, gridUV.y)
		             * smoothstep(0.5 + windowHeight * 0.5, 0.5 + windowHeight * 0.5 - 0.05, gridUV.y);
		float windowMask = windowX * windowY;

		// Per-window random (hash from cell position)
		vec2 cellId = vec2(floor(wp.x * 0.12), floorIndex);
		float rand = fract(sin(dot(cellId, vec2(127.1, 311.7))) * 43758.5453);

		// Floor-level randomization (some whole floors dark = empty offices)
		float floorRand = fract(sin(floorIndex * 131.7) * 43758.5453);
		float floorLit = step(0.2, floorRand);
		float fullyLitFloor = step(0.93, floorRand); // ~7% of floors fully lit

		float lit = step(1.0 - adjustedDensity, rand) * floorLit;
		lit = max(lit, fullyLitFloor); // fully lit floors override

		// Window color variation (5 types)
		float colorMix = fract(sin(dot(cellId, vec2(269.5, 183.3))) * 7461.7);
		vec3 warmColor = vec3(1.0, 0.65, 0.35);     // warm residential
		vec3 coolColor = vec3(0.8, 0.9, 1.0);        // cool office
		vec3 retailColor = vec3(1.0, 0.85, 0.6);     // retail/lobby
		vec3 screenColor = vec3(0.55, 0.65, 1.0);    // blueish screens
		vec3 officeWhite = vec3(1.0, 0.97, 0.92);    // fluorescent office

		vec3 upperColor = mix(
			mix(warmColor, coolColor, smoothstep(0.0, 0.4, colorMix)),
			mix(screenColor, officeWhite, smoothstep(0.6, 1.0, colorMix)),
			step(0.5, colorMix)
		);
		vec3 windowColor = mix(upperColor, retailColor, isGroundFloor);

		// Per-window brightness variation
		float brightVar = fract(sin(dot(cellId, vec2(419.2, 371.9))) * 29475.1);
		float windowBright = mix(0.6, 1.4, brightVar);

		// Subtle flicker (AC hum simulation)
		float flicker = 0.93 + 0.07 * sin(u_time * 0.3 + rand * 6.28);

		// Street-level ambient glow (sodium lamps illuminate building bases)
		float streetGlow = smoothstep(6.0, 0.0, wp.z) * 0.4;
		vec3 streetLampColor = vec3(1.0, 0.82, 0.45);

		// Rooftop aviation warning lights (tall buildings only, slow blink)
		float isTall = smoothstep(30.0, 50.0, buildingHeight);
		float blink = step(0.4, fract(u_time * 0.5));
		float rooftopLight = isRoof * isTall * blink;
		vec3 aviationRed = vec3(1.0, 0.08, 0.03);

		// Darken building surfaces at night
		material.diffuse *= mix(1.0, 0.015, u_nightFactor);

		// Compose emission layers
		vec3 emission = vec3(0.0);
		emission += windowColor * windowMask * lit * isWall * flicker * windowBright * 2.2;
		emission += streetLampColor * streetGlow * isWall;
		emission += aviationRed * rooftopLight * 4.0;

		material.emissive = emission * u_nightFactor;
	}
`;

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

// ========================================================================
// Selective Night Bloom (3-pass pipeline)
// ========================================================================

// Pass 1: Extract only bright pixels (city lights, building windows)
export const BLOOM_EXTRACT_GLSL = `
	uniform sampler2D colorTexture;
	uniform float u_nightFactor;
	uniform float u_threshold;
	in vec2 v_textureCoordinates;

	void main() {
		vec4 color = texture(colorTexture, v_textureCoordinates);
		float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
		float extract = smoothstep(u_threshold, u_threshold + 0.2, lum);
		out_FragColor = vec4(color.rgb * extract * u_nightFactor, 1.0);
	}
`;

// Pass 2a: Gaussian blur horizontal (5-tap kernel at half resolution)
// FIX 4: Renamed `step` to `texelSize` to avoid shadowing GLSL built-in
export const BLOOM_BLUR_X_GLSL = `
	uniform sampler2D colorTexture;
	in vec2 v_textureCoordinates;

	void main() {
		vec2 texelSize = 1.0 / czm_viewport.zw;
		vec3 result = texture(colorTexture, v_textureCoordinates).rgb * 0.2270270270;
		result += texture(colorTexture, v_textureCoordinates + vec2(texelSize.x * 1.3846153846, 0.0)).rgb * 0.3162162162;
		result += texture(colorTexture, v_textureCoordinates - vec2(texelSize.x * 1.3846153846, 0.0)).rgb * 0.3162162162;
		result += texture(colorTexture, v_textureCoordinates + vec2(texelSize.x * 3.2307692308, 0.0)).rgb * 0.0702702703;
		result += texture(colorTexture, v_textureCoordinates - vec2(texelSize.x * 3.2307692308, 0.0)).rgb * 0.0702702703;
		// Warm tint: slight amber shift for realistic city glow
		result *= vec3(1.0, 0.95, 0.85);
		out_FragColor = vec4(result, 1.0);
	}
`;

// Pass 2b: Gaussian blur vertical (5-tap kernel at half resolution)
// FIX 4: Renamed `step` to `texelSize` to avoid shadowing GLSL built-in
export const BLOOM_BLUR_Y_GLSL = `
	uniform sampler2D colorTexture;
	in vec2 v_textureCoordinates;

	void main() {
		vec2 texelSize = 1.0 / czm_viewport.zw;
		vec3 result = texture(colorTexture, v_textureCoordinates).rgb * 0.2270270270;
		result += texture(colorTexture, v_textureCoordinates + vec2(0.0, texelSize.y * 1.3846153846)).rgb * 0.3162162162;
		result += texture(colorTexture, v_textureCoordinates - vec2(0.0, texelSize.y * 1.3846153846)).rgb * 0.3162162162;
		result += texture(colorTexture, v_textureCoordinates + vec2(0.0, texelSize.y * 3.2307692308)).rgb * 0.0702702703;
		result += texture(colorTexture, v_textureCoordinates - vec2(0.0, texelSize.y * 3.2307692308)).rgb * 0.0702702703;
		out_FragColor = vec4(result, 1.0);
	}
`;

// Pass 3: Composite — additive blend of bloom onto original scene
export const BLOOM_COMPOSITE_GLSL = `
	uniform sampler2D colorTexture;
	uniform sampler2D bloomTexture;
	uniform float u_intensity;
	in vec2 v_textureCoordinates;

	void main() {
		vec4 scene = texture(colorTexture, v_textureCoordinates);
		vec4 bloom = texture(bloomTexture, v_textureCoordinates);
		out_FragColor = vec4(scene.rgb + bloom.rgb * u_intensity, 1.0);
	}
`;
