/**
 * Common GLSL Shader Utilities
 *
 * Shared shader code fragments to be included in custom shaders.
 * Reduces duplication of noise functions, hash functions, etc.
 *
 * Usage: Import and concatenate with your shader code:
 * ```
 * const shader = GLSL_COMMON + `
 *   void main() {
 *     float n = hash(vUv);
 *     ...
 *   }
 * `;
 * ```
 */

/**
 * Simple 2D hash function
 * Converts 2D coordinates to pseudo-random value (0-1)
 */
export const GLSL_HASH_2D = /* glsl */ `
float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
`;

/**
 * Simple 3D hash function
 * Converts 3D coordinates to pseudo-random value (0-1)
 */
export const GLSL_HASH_3D = /* glsl */ `
float hash3D(vec3 p) {
	return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
`;

/**
 * Simple 2D noise function
 * Perlin-style noise using hash interpolation
 */
export const GLSL_NOISE_2D = /* glsl */ `
${GLSL_HASH_2D}

float noise(vec2 p) {
	return hash(p);
}
`;

/**
 * Improved 2D noise with smoothstep interpolation
 */
export const GLSL_SMOOTH_NOISE_2D = /* glsl */ `
${GLSL_HASH_2D}

float smoothNoise2D(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);

	// Smoothstep interpolation
	f = f * f * (3.0 - 2.0 * f);

	// Sample corners
	float a = hash(i);
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));

	// Bilinear interpolation
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

/**
 * Fractal Brownian Motion (FBM) for 2D noise
 * Multiple octaves of noise for organic detail
 */
export const GLSL_FBM_2D = /* glsl */ `
${GLSL_SMOOTH_NOISE_2D}

float fbm2D(vec2 p, int octaves) {
	float value = 0.0;
	float amplitude = 0.5;
	float frequency = 1.0;

	for (int i = 0; i < 8; i++) {
		if (i >= octaves) break;
		value += amplitude * smoothNoise2D(p * frequency);
		amplitude *= 0.5;
		frequency *= 2.0;
	}

	return value;
}
`;

/**
 * Common utility functions
 */
export const GLSL_UTILS = /* glsl */ `
// Remap value from one range to another
float remap(float value, float inMin, float inMax, float outMin, float outMax) {
	return outMin + (value - inMin) * (outMax - outMin) / (inMax - inMin);
}

// Smooth minimum (creates smooth blending between shapes)
float smin(float a, float b, float k) {
	float h = max(k - abs(a - b), 0.0) / k;
	return min(a, b) - h * h * k * 0.25;
}

// Smooth maximum
float smax(float a, float b, float k) {
	return -smin(-a, -b, k);
}

// Exponential ease out
float easeOutExpo(float t) {
	return t == 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
}

// Cubic ease in-out
float easeInOutCubic(float t) {
	return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

// Quadratic ease in-out
float easeInOut(float t) {
	return t < 0.5 ? 2.0 * t * t : 1.0 - pow(-2.0 * t + 2.0, 2.0) / 2.0;
}
`;

/**
 * Complete common shader library
 * Includes all utility functions
 */
export const GLSL_COMMON = GLSL_HASH_2D + '\n' + GLSL_HASH_3D + '\n' + GLSL_UTILS;
