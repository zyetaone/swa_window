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

import { COLOR_GRADE_STAGE } from '$lib/world/shaders';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CesiumViewer = any;

export const HASH_PALETTE_SHADER = /* glsl */ `
	uniform sampler2D colorTexture;
	uniform float u_nightFactor;
	uniform float u_lightIntensity;
	uniform float u_darkVoidStrength;
	uniform float u_envLight;
	uniform float u_additiveStrength;

	void main() {
		vec4 color = texture(colorTexture, v_textureCoordinates);
		vec3 rgb = color.rgb;
		float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

		float brightGuard = smoothstep(0.75, 0.95, lum);
		float lightMask = smoothstep(0.08, 0.65, lum);

		// Chroma-bias VIIRS gate — warm pixels (red > blue) get palette treatment.
		float redBias = clamp(rgb.r - rgb.b, 0.0, 1.0);
		float viirsLikely = smoothstep(0.05, 0.3, redBias);
		lightMask *= mix(1.0, viirsLikely, 0.85);

		// Desat under lights to kill blue-base → purple bleed.
		vec3 grayBase = vec3(lum);
		rgb = mix(rgb, grayBase, lightMask * 0.8 * u_nightFactor);

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
		float darkenAmount = smoothstep(0.45, 0.9, u_nightFactor) * 0.85;
		rgb = mix(rgb, vec3(0.02, 0.04, 0.08), darkenAmount * (1.0 - lightMask) * (1.0 - brightGuard));

		// Dark void crush for unlit terrain.
		float darkVoid = 1.0 - smoothstep(0.05, 0.2, lum);
		rgb = mix(rgb, vec3(0.0), darkVoid * u_nightFactor * u_darkVoidStrength * (1.0 - brightGuard));

		// Pollution corona.
		float pollution = smoothstep(0.10, 0.5, lum) * u_nightFactor;
		rgb = min(rgb + vec3(0.18, 0.09, 0.02) * pollution * u_lightIntensity, vec3(1.0));

		// Ambient floor — warm tint so terrain never goes pure black.
		vec3 ambient = vec3(0.025, 0.022, 0.018) * u_envLight * u_nightFactor;

		out_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
	}
`;

export function installHashPalette(
	viewer: CesiumViewer,
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
			prevAeroEnabled = aeroStage.enabled;
			aeroStage.enabled = false;
			break;
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const Cesium = (viewer as any).cesiumWidget?.constructor as any;
	if (!Cesium?.PostProcessStage) return () => {
		if (aeroStage) aeroStage.enabled = prevAeroEnabled;
	};

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
