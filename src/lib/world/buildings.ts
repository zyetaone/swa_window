/**
 * BuildingsManager — ES6 class for OSM 3D Tiles buildings.
 *
 * Owns the tileset, procedural lit-window shader, city-brightness
 * sampling, and per-frame uniform sync. Uses CustomShader API for
 * per-fragment window grid math (no per-feature property dependency).
 */

import type * as CesiumType from 'cesium';
import { getIonToken } from './cesium-setup';
import { getViirsField } from './viirs-field';
import { BUILDING_SHADER_GLSL, BUILDING_VERTEX_GLSL } from './building-shader';
import { smoothstep } from '$lib/utils';
import { altitudeDetailMix } from '$lib/world/altitude';
import { CESIUM_QUALITY_PRESETS } from './model';
import { EpsilonGate } from './util';

type C = typeof CesiumType;

interface BuildingsShader {
	setUniform(name: string, value: number): void;
}

export class BuildingsManager {
	readonly #C: C;
	readonly #viewer: CesiumType.Viewer;

	tileset: CesiumType.Cesium3DTileset | null = null;
	#shader: BuildingsShader | null = null;
	#time = 0;
	#cityBrightness = 1;
	#cityBrightnessTimer = 0;
	#show = new EpsilonGate<boolean>(0, true);
	#nightFactor = new EpsilonGate<number>(0.02, -1);

	constructor(Cesium: C, viewer: CesiumType.Viewer) {
		this.#C = Cesium;
		this.#viewer = viewer;
	}

	// ── Setup ────────────────────────────────────────────────────────────────

	async setup(buildingsEnabled: boolean): Promise<void> {
		if (!getIonToken()) { console.warn('[Buildings] Ion token missing — disabled'); return; }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const C = this.#C as any;
		try {
			this.tileset = await this.#C.createOsmBuildingsAsync();
			if (!this.tileset) return;
			this.tileset.show = buildingsEnabled;
			this.tileset.maximumScreenSpaceError = CESIUM_QUALITY_PRESETS.balanced.maximumScreenSpaceError;
			this.tileset.shadows = this.#C.ShadowMode.ENABLED;
			this.tileset.colorBlendMode = this.#C.Cesium3DTileColorBlendMode.HIGHLIGHT;

			try {
				this.#shader = new C.CustomShader({
					mode: C.CustomShaderMode.MODIFY_MATERIAL,
					lightingModel: C.LightingModel.PBR,
					uniforms: {
						u_nightFactor:    { type: C.UniformType.FLOAT, value: 0.0 },
						u_lightIntensity: { type: C.UniformType.FLOAT, value: 1.0 },
						u_windowDensity:  { type: C.UniformType.FLOAT, value: 0.0 },
						u_cityBrightness: { type: C.UniformType.FLOAT, value: 1.0 },
						u_time:           { type: C.UniformType.FLOAT, value: 0.0 },
					},
					varyings: { v_normalMC: C.VaryingType.VEC3 },
					vertexShaderText: BUILDING_VERTEX_GLSL,
					fragmentShaderText: BUILDING_SHADER_GLSL,
				});
				this.tileset.customShader = this.#shader as unknown as CesiumType.CustomShader;
			} catch (e) {
				console.warn('[Buildings] Custom shader failed:', (e as { message?: string })?.message ?? String(e));
				this.#shader = null;
			}

			this.#viewer.scene.primitives.add(this.tileset);
		} catch (e) { console.warn('[Buildings] OSM unavailable:', (e as Error).message); }
	}

	// ── Per-tick sync ────────────────────────────────────────────────────────

	sync(
		dt: number,
		nf: number,
		scale: number,
		altFt: number,
		buildingsEnabled: boolean,
		windowLightIntensity: number,
		bootFade: number,
	): void {
		if (!this.tileset) return;
		this.#show.update(buildingsEnabled, (v) => { this.tileset!.show = v; });

		if (this.#shader) {
			this.#time = (this.#time + dt) % (Math.PI * 4000);
			this.#shader.setUniform('u_nightFactor', nf * bootFade);
			this.#shader.setUniform('u_lightIntensity', scale);
			this.#shader.setUniform('u_windowDensity', (1 - altitudeDetailMix(altFt)) * smoothstep((nf - 0.15) / 0.7) * windowLightIntensity);
			this.#shader.setUniform('u_time', this.#time);
			this.#shader.setUniform('u_cityBrightness', this.#sampleCityBrightness());
			return;
		}

		// Fallback: uniform amber style when shader unavailable.
		this.#nightFactor.update(nf, (v) => {
			this.tileset!.style = new this.#C.Cesium3DTileStyle({
				color: `color("rgb(255, 200, 50)", ${Math.max(0.3, v * 0.9).toFixed(2)})`,
			});
		});
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	/** Sample VIIRS luminance under the camera — throttled to 2 Hz, lerp-smoothed. */
	#sampleCityBrightness(): number {
		const now = performance.now();
		if (now - this.#cityBrightnessTimer < 500) return this.#cityBrightness;
		this.#cityBrightnessTimer = now;

		const carto = this.#viewer?.camera?.positionCartographic;
		if (!carto) return this.#cityBrightness;
		const C = this.#C;
		const lat = C.Math.toDegrees(carto.latitude);
		const lon = C.Math.toDegrees(carto.longitude);
		const field = getViirsField(lat, lon);
		if (!field) return this.#cityBrightness;

		const STEP_DEG = 0.018; // ~2km
		let sum = 0, count = 0;
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				const s = field.sampleBilinear(lat + dy * STEP_DEG, lon + dx * STEP_DEG);
				if (s > 0) { sum += s; count++; }
			}
		const target = count > 0 ? sum / count : field.sampleBilinear(lat, lon);
		this.#cityBrightness += (target - this.#cityBrightness) * 0.3;
		return this.#cityBrightness;
	}

	setWireframe(enabled: boolean): void {
		if (!this.tileset) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(this.tileset as any).debugWireframe = enabled;
	}

	updateQuality(maximumScreenSpaceError: number): void {
		if (this.tileset) this.tileset.maximumScreenSpaceError = maximumScreenSpaceError;
	}
}
