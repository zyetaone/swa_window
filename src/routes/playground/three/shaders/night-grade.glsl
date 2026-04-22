// night-grade.glsl — SWA color-grading post-process fragment shader.
//
// Ported from src/lib/world/shaders.ts (COLOR_GRADING_GLSL, Cesium prod).
// Core technique identical: luminance-driven palette remap + hash noise
// for per-pixel palette variance, then pollution corona, dark crush,
// horizon haze, and dawn/dusk rim light. Palette retuned for SWA
// (Southwest) brand — warmer sodium, Canyon Yellow amber, and a rare
// SWA Heart Red traffic-spark accent.
//
// Input:  tDiffuse (MapLibre canvas composited frame, fed by Three.js
//         EffectComposer as the first pass's RenderTarget)
// Output: RGBA with color grading applied; Bloom runs AFTER this pass.
//
// Uniforms wired from sky-phase.ts + pg state by ColorGradePass.
precision highp float;

uniform sampler2D tDiffuse;
uniform float u_nightFactor;
uniform float u_dawnDuskFactor;
uniform float u_lightIntensity;
varying vec2 vUv;

void main() {
	vec4 color = texture2D(tDiffuse, vUv);
	vec3 rgb = color.rgb;
	float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

	// --- Bright Pixel Guard ---
	// Preserve sun disc, bright sky highlights, specular reflections from
	// night crush. Same thresholds as Cesium prod.
	float brightGuard = smoothstep(0.75, 0.95, lum);

	// --- Night City Light Coloring ---
	// Shallow luminance ramp so spill pixels between lit roads pick up 20-
	// 30% warm treatment, reading perceptually as glow spill.
	float lightMask = smoothstep(0.08, 0.65, lum);

	// Desaturate base so underlying blue atmosphere doesn't turn orange
	// lights into purple/mud at night.
	vec3 grayBase = vec3(lum);
	rgb = mix(rgb, grayBase, lightMask * 0.8 * u_nightFactor);

	// --- Per-pixel palette variance ---
	// Hash from screen UV shifts each pixel's palette-lookup luminance by
	// ±0.08, so neighbouring pixels resolve into different palette buckets
	// even if they share luminance. Breaks flat-amber look.
	float hash = fract(sin(dot(vUv * 1000.0, vec2(12.9898, 78.233))) * 43758.5453);
	float paletteLum = clamp(lum + (hash - 0.5) * 0.16, 0.0, 1.0);

	// --- SWA city-light palette ---
	// Retuned from generic sodium/amber/warm/cool/blue-white:
	//   sodium     — warmer, less pure-orange than prod
	//   amber      — Canyon Yellow–leaning (SWA Canyon Blue counterpart)
	//   warmWht    — warm paper white (incandescent feel)
	//   coolWht    — subtle cool (daylight LED)
	//   blueWht    — modern high-CCT LED
	//   trafficRed — SWA Heart Red accent, rare sparks only
	vec3 sodium     = vec3(0.85, 0.45, 0.15);
	vec3 amber      = vec3(1.00, 0.72, 0.28);
	vec3 warmWht    = vec3(1.00, 0.94, 0.82);
	vec3 coolWht    = vec3(0.88, 0.93, 1.00);
	vec3 blueWht    = vec3(0.72, 0.82, 1.00);
	vec3 trafficRed = vec3(0.90, 0.12, 0.20);

	// Luminance-bucketed palette using hashed paletteLum per-pixel.
	vec3 lightColor = mix(sodium, amber, smoothstep(0.15, 0.4, paletteLum));
	lightColor = mix(lightColor, warmWht, smoothstep(0.4, 0.65, paletteLum));
	lightColor = mix(lightColor, coolWht, smoothstep(0.65, 0.85, paletteLum));
	lightColor = mix(lightColor, blueWht, smoothstep(0.85, 1.0, paletteLum));

	// Sparse red-spark layer — ~2% of lit pixels mix toward SWA Heart Red.
	// Accent-only amplitude (0.3) — the bloom stage amplifies bright
	// pixels, so keep red subtle here or it becomes visible blobs.
	float redSpark = step(0.98, fract(hash * 7.3));
	lightColor = mix(lightColor, trafficRed, redSpark * lightMask * 0.3);

	// Additive emissive injection — tuned down from prod's 1.6 because
	// our MapLibre VIIRS input raster is hotter than Cesium's atmosphere-
	// dimmed render, and the bloom pass spreads already-bright pixels.
	// 0.9 keeps cities emissive without blowing out to white halos.
	rgb += lightColor * lum * 0.9 * u_nightFactor;
	rgb = min(rgb, vec3(1.4));

	// --- Dark Void Crush ---
	// Keep terrain visible at night — dim terrain loses ~30% brightness.
	float darkVoid = 1.0 - smoothstep(0.05, 0.2, lum);
	rgb = mix(rgb, vec3(0.0), darkVoid * u_nightFactor * 0.3 * (1.0 - brightGuard));

	// --- Light pollution corona ---
	// Warm amber dome from altitude; rural stays unaffected.
	float pollution = smoothstep(0.10, 0.5, lum) * u_nightFactor;
	rgb += vec3(0.18, 0.09, 0.02) * pollution * u_lightIntensity;

	// Crush shadows — max() guards against NaN from pow() on negative
	// HDR. brightGuard reduces crush on sun / specular pixels.
	float shadowCrush = 1.0 - (0.4 * u_nightFactor * (1.0 - brightGuard));
	rgb = pow(max(rgb, vec3(0.0)), vec3(1.0 / shadowCrush));

	// High contrast — reduced for bright pixels to preserve sun/sky.
	float contrast = 1.0 + (0.3 * u_nightFactor * (1.0 - brightGuard));
	rgb = (rgb - 0.5) * contrast + 0.5;

	// --- Horizon Atmospheric Haze ---
	// Pale band at the horizon line (~35% from top) — warm amber at
	// dawn/dusk, invisible at night.
	float horizonY = 0.35;
	float horizonBand = 1.0 - abs(vUv.y - horizonY) / 0.2;
	horizonBand = clamp(horizonBand, 0.0, 1.0);
	vec3 hazeColor = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.8, 0.5), u_dawnDuskFactor);
	rgb = mix(rgb, hazeColor, horizonBand * 0.15 * (1.0 - u_nightFactor));

	// --- Dawn/Dusk Directional Rim Light ---
	// Left-edge warm gold wash, fading across viewport. Only active at
	// dawn/dusk (u_dawnDuskFactor > 0).
	float rimX = 1.0 - vUv.x;
	float rimLight = rimX * u_dawnDuskFactor * 0.25;
	vec3 warmRim = vec3(1.0, 0.7, 0.3) * rimLight;
	rgb += warmRim * (1.0 - u_nightFactor);

	gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}
