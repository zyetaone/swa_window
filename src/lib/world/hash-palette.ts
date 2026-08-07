/**
 * Hash-palette night post-process stage (Apr-15 resurrection).
 *
 * 3-stop warm palette (sodium → amber → warm-white) driven by per-pixel UV hash
 * + 3% traffic-red sparks. Replaces aero-color-grade while active.
 *
 * Usage:
 *   const cleanup = installHashPalette(viewer, getNightFactor, getNightLightScale);
 *   // ... later:
 *   cleanup(); // removes stage, restores aero-color-grade
 */

import type * as CesiumType from 'cesium';
import { COLOR_GRADE_STAGE } from '$lib/world/shaders';

export const HASH_PALETTE_SHADER = /* glsl */ `
	uniform sampler2D colorTexture;
	uniform float u_nightFactor;
	uniform float u_lightIntensity;
	uniform float u_darkVoidStrength;
	uniform float u_envLight;
	uniform float u_additiveStrength;
	// MUST be declared. Cesium prepends the version/precision preamble and the
	// out_FragColor declaration, but NOT the varying — COLOR_GRADING_GLSL in
	// shaders.ts declares its own, and this shader was written without one, so
	// it failed to compile and Cesium halted rendering entirely on every night
	// frame ("An error occurred while rendering. Rendering has stopped.").
	in vec2 v_textureCoordinates;

	void main() {
		vec4 color = texture(colorTexture, v_textureCoordinates);
		vec3 rgb = color.rgb;
		float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

		float brightGuard = smoothstep(0.75, 0.95, lum);
		float lightMask = smoothstep(0.15, 0.65, lum);

		// The chroma-bias gate that used to live here is gone. It asked "is this
		// pixel warm (red > blue)?" and cut lightMask to 15% when the answer was
		// no — intended to find VIIRS pixels and skip cool ones. It could never
		// work: compose.ts desaturates the VIIRS layer to greyscale BEFORE this
		// stage runs, so ground night-lights arrived with red == blue and were
		// permanently held at 15% of their palette treatment, while genuinely
		// warm sources (building windows, car lights) got the full 100%. The
		// ground looked flat next to the buildings for that reason alone.
		//
		// Moot regardless: the source is a greyscale RADIANCE product
		// (viirs-field.ts), so red == blue at the source and no saturation
		// value could give a chroma gate a signal.
		//
		// Luminance alone selects lights, which is what the gate was reaching for.
		// Safe against amber-ing the sky: this is a CESIUM post-process stage, so
		// the Three overlay (moon, stars, clouds) composites above it untouched.
		//
		// ⚠ This brightens ground night-lights ~6.7x in palette contribution.
		// Intended, but it is a look change — verify at /?time=22 before shipping.

		// Desat under lights to kill blue-base → purple bleed.
		vec3 grayBase = vec3(lum);
		rgb = mix(rgb, grayBase, lightMask * 0.4 * u_nightFactor);

		// Per-pixel UV hash for palette variance.
		float hash = fract(sin(dot(v_textureCoordinates * 1000.0, vec2(12.9898, 78.233))) * 43758.5453);
		float paletteLum = clamp(lum + (hash - 0.5) * 0.25, 0.0, 1.0);

		vec3 sodium   = vec3(1.0, 0.6, 0.2);
		vec3 amber    = vec3(1.0, 0.8, 0.4);
		vec3 warmWht  = vec3(1.0, 0.95, 0.85);
		vec3 trafficRed = vec3(1.0, 0.15, 0.05);

		vec3 lightColor = mix(sodium, amber, smoothstep(0.15, 0.5, paletteLum));
		lightColor = mix(lightColor, warmWht, smoothstep(0.5, 0.9, paletteLum));

		float redSpark = step(0.97, fract(hash * 7.3));
		lightColor = mix(lightColor, trafficRed, redSpark * lightMask * 0.8);
		rgb += lightColor * lum * lightMask * u_additiveStrength * u_nightFactor;
		rgb = min(rgb, vec3(4.0));

		// Base darkening — lightMask guards cities.
		float darkenAmount = smoothstep(0.45, 0.9, u_nightFactor) * 0.45;
		rgb = mix(rgb, vec3(0.035, 0.040, 0.045), darkenAmount * (1.0 - lightMask) * (1.0 - brightGuard));

		// Dark void crush for unlit terrain.
		float darkVoid = 1.0 - smoothstep(0.05, 0.2, lum);
		rgb = mix(rgb, vec3(0.0), darkVoid * u_nightFactor * u_darkVoidStrength * (1.0 - brightGuard));

		// Pollution corona.
		float pollution = smoothstep(0.10, 0.5, lum) * u_nightFactor;
		rgb = min(rgb + vec3(0.18, 0.09, 0.02) * pollution * u_lightIntensity, vec3(1.0));

		// Ambient floor — warm tint so terrain never goes pure black.
		//
		// ─── ⚠ ADDITIVE LIFT, NOT max() ─────────────────────────────────────────
		// This was rgb = max(rgb, ambient) with ambient scaled by u_envLight
		// (4.0 by default), which put the floor at 8-bit luminance 54.8. Because
		// max() CLAMPS UP, every terrain pixel darker than that became exactly
		// that value — measured: the median pixel of a night frame was 54.8 in
		// three consecutive builds, i.e. most of the screen was one flat colour.
		// The scene then reads as washed-out AND dark at the same time: no terrain
		// detail survives, and the floor is bright enough to mute nearby city
		// lights by comparison.
		// An additive lift scaled by how dark the pixel already is keeps the floor
		// (nothing crushes to pure black) while PRESERVING relative variation, so
		// terrain shape and the light field both stay visible.
		// Multiplying the lift by the pixel's own value (plus a small floor) keeps
		// terrain VARIATION proportional instead of pasting a constant over it.
		// A flat add was measurably too strong on low-light scenes: ground standard
		// deviation fell to 4.0 at the Himalayas and 9.2 at Hyderabad, i.e. the
		// lift was dominating the terrain signal it exists to reveal.
		vec3 ambient = vec3(0.065, 0.052, 0.038) * u_envLight * u_nightFactor;
		float darkness = 1.0 - smoothstep(0.0, 0.35, lum);
		rgb += ambient * darkness * (0.35 + 1.6 * lum);

		out_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
	}
`;

export function installHashPalette(
	Cesium: typeof CesiumType,
	viewer: CesiumType.Viewer,
	getNightFactor: () => number,
	getNightLightScale: () => number,
	getDarkVoidStrength: () => number,
	getEnvLight: () => number,
	getAdditiveStrength: () => number,
): () => void {
	const stages = viewer.scene.postProcessStages;
	if (!stages) return () => {};

	// Disable aero-color-grade while hash palette is active.
	let aeroStage: { enabled: boolean } | null = null;
	let prevAeroEnabled = true;
	for (let i = 0; i < stages.length; i++) {
		const s = stages.get(i) as { name?: string; enabled?: boolean } | null;
		if (s && s.name === COLOR_GRADE_STAGE) {
			aeroStage = s as { enabled: boolean };
			prevAeroEnabled = s.enabled ?? true;
			break;
		}
	}
	if (aeroStage) aeroStage.enabled = false;

	const stage = new Cesium.PostProcessStage({
		name: 'hash-palette-night',
		fragmentShader: HASH_PALETTE_SHADER,
		uniforms: {
			u_nightFactor: getNightFactor,
			u_lightIntensity: getNightLightScale,
			u_darkVoidStrength: getDarkVoidStrength,
			u_envLight: getEnvLight,
			u_additiveStrength: getAdditiveStrength,
		},
	});
	stages.add(stage);

	return () => {
		if (!viewer.isDestroyed()) {
			stages.remove(stage);
			if (aeroStage) aeroStage.enabled = prevAeroEnabled;
		}
	};
}