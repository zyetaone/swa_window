/**
 * world/buildings — OSM buildings setup + per-frame sync (MRAX: Actions layer).
 *
 * Extracted from compose.ts. Stateful — holds tileset, shader, timing fields
 * in a BuildingsState bag so the CesiumManager orchestrator remains thin.
 */
import type * as CesiumType from 'cesium';
import { getIonToken } from './cesium-setup';
import { getViirsField } from './viirs-field';
import { BUILDING_SHADER_GLSL, BUILDING_VERTEX_GLSL } from './building-shader';
import { buildingWindowDensity } from './rules';
import { CESIUM_QUALITY_PRESETS } from './model';

export interface BuildingsState {
	tileset: CesiumType.Cesium3DTileset | null;
	buildingsShader: any;
	buildingsTime: number;
	cityBrightness: number;
	cityBrightnessTimer: number;
	lastBuildingsShow: boolean;
	lastBuildingNightFactor: number;
}

export function createBuildingsState(): BuildingsState {
	return {
		tileset: null,
		buildingsShader: null,
		buildingsTime: 0,
		cityBrightness: 1,
		cityBrightnessTimer: 0,
		lastBuildingsShow: true,
		lastBuildingNightFactor: -1,
	};
}

export async function setupBuildings(
	state: BuildingsState,
	CesiumModule: typeof CesiumType,
	viewer: CesiumType.Viewer,
	buildingsEnabled: boolean,
): Promise<void> {
	if (!getIonToken()) { console.warn('[CesiumBuildings] Ion token missing — buildings disabled'); return; }
	const C: any = CesiumModule;
	try {
		state.tileset = await CesiumModule.createOsmBuildingsAsync();
		if (state.tileset) {
			state.tileset.show = buildingsEnabled;
			state.tileset.maximumScreenSpaceError = CESIUM_QUALITY_PRESETS.balanced.maximumScreenSpaceError;
			state.tileset.shadows = CesiumModule.ShadowMode.ENABLED;
			state.tileset.colorBlendMode = CesiumModule.Cesium3DTileColorBlendMode.HIGHLIGHT;
			try {
				state.buildingsShader = new C.CustomShader({
					mode: C.CustomShaderMode.MODIFY_MATERIAL,
					lightingModel: C.LightingModel.PBR,
					uniforms: {
						u_nightFactor: { type: C.UniformType.FLOAT, value: 0.0 },
						u_lightIntensity: { type: C.UniformType.FLOAT, value: 1.0 },
						u_windowDensity: { type: C.UniformType.FLOAT, value: 0.0 },
						u_cityBrightness: { type: C.UniformType.FLOAT, value: 1.0 },
						u_time: { type: C.UniformType.FLOAT, value: 0.0 },
					},
					varyings: {
						v_normalMC: C.VaryingType.VEC3,
					},
					vertexShaderText: BUILDING_VERTEX_GLSL,
					fragmentShaderText: BUILDING_SHADER_GLSL,
				});
				state.tileset.customShader = state.buildingsShader;
			} catch (e) {
				const msg = (e as any)?.message ?? String(e);
				console.warn('[CesiumBuildings] Custom shader failed; falling back to uniform amber style:', msg);
				state.buildingsShader = null;
			}
			viewer.scene.primitives.add(state.tileset);
		}
	} catch (e) { console.warn('[CesiumBuildings] OSM buildings unavailable:', (e as Error).message); }
}

function sampleCityBrightness(
	state: BuildingsState,
	CesiumModule: typeof CesiumType,
	viewer: CesiumType.Viewer,
): number {
	const now = performance.now();
	if (now - state.cityBrightnessTimer < 500) return state.cityBrightness;
	state.cityBrightnessTimer = now;
	const carto = viewer?.camera?.positionCartographic;
	if (!carto) return state.cityBrightness;
	const C = CesiumModule;
	const lat = C.Math.toDegrees(carto.latitude);
	const lon = C.Math.toDegrees(carto.longitude);
	const field = getViirsField(lat, lon);
	if (!field) return state.cityBrightness;
	const STEP_DEG = 0.018;
	let sum = 0, count = 0;
	for (let dy = -1; dy <= 1; dy++)
		for (let dx = -1; dx <= 1; dx++) {
			const s = field.sampleBilinear(lat + dy * STEP_DEG, lon + dx * STEP_DEG);
			if (s > 0) { sum += s; count++; }
		}
	const target = count > 0 ? sum / count : field.sampleBilinear(lat, lon);
	state.cityBrightness += (target - state.cityBrightness) * 0.3;
	return state.cityBrightness;
}

export function syncBuildings(
	state: BuildingsState,
	dt: number,
	nf: number,
	scale: number,
	altFt: number,
	buildingsEnabled: boolean,
	windowLightIntensity: number,
	getBootFade: () => number,
	CesiumModule: typeof CesiumType,
	viewer: CesiumType.Viewer,
): void {
	if (!state.tileset) return;
	if (buildingsEnabled !== state.lastBuildingsShow) {
		state.lastBuildingsShow = buildingsEnabled;
		state.tileset.show = buildingsEnabled;
	}

	if (state.buildingsShader) {
		const bootFade = getBootFade();
		state.buildingsTime = (state.buildingsTime + dt) % (Math.PI * 4000);
		state.buildingsShader.setUniform('u_nightFactor', nf * bootFade);
		state.buildingsShader.setUniform('u_lightIntensity', scale);
		state.buildingsShader.setUniform('u_windowDensity', buildingWindowDensity(nf, windowLightIntensity, altFt));
		state.buildingsShader.setUniform('u_time', state.buildingsTime);
		state.buildingsShader.setUniform('u_cityBrightness', sampleCityBrightness(state, CesiumModule, viewer));
		return;
	}

	if (Math.abs(nf - state.lastBuildingNightFactor) < 0.02) return;
	state.lastBuildingNightFactor = nf;
	state.tileset.style = new CesiumModule.Cesium3DTileStyle({
		color: `color("rgb(255, 200, 50)", ${Math.max(0.3, nf * 0.9).toFixed(2)})`,
	});
}

export function setBuildingsWireframe(state: BuildingsState, enabled: boolean): void {
	if (!state.tileset) return;
	(state.tileset as any).debugWireframe = enabled;
}

export function disposeBuildings(state: BuildingsState): void {
	state.tileset = null;
	state.buildingsShader = null;
}
