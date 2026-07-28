/**
 * Buildings — OSM 3D Tiles + procedural lit-window CustomShader.
 *
 * Call lifecycle:
 *   initBuildings(C, v)               — once, stores refs
 *   setupBuildings(enabled)            — once, async, creates tileset + shader
 *   syncBuildings(dt, nf, scale, ...)  — per-tick
 *   setWireframe(enabled)              — operator toggle
 *   updateQuality(sse)                 — quality preset change
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

let _cs: C;
let _viewer: CesiumType.Viewer;

export let tileset: CesiumType.Cesium3DTileset | null = null;
let _shader: BuildingsShader | null = null;
let _time = 0;
let _cityBrightness = 1;
let _cityBrightnessTimer = 0;
const _show = new EpsilonGate<boolean>(0, true);
const _nightFactor = new EpsilonGate<number>(0.02, -1);

export function initBuildings(Cesium: C, viewer: CesiumType.Viewer): void {
	_cs = Cesium; _viewer = viewer;
}

export async function setupBuildings(buildingsEnabled: boolean): Promise<void> {
	if (!getIonToken()) { console.warn('[Buildings] Ion token missing — disabled'); return; }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const C = _cs as any;
	try {
		tileset = await _cs.createOsmBuildingsAsync();
		if (!tileset) return;
		tileset.show = buildingsEnabled;
		tileset.maximumScreenSpaceError = CESIUM_QUALITY_PRESETS.balanced.maximumScreenSpaceError;
		tileset.shadows = _cs.ShadowMode.ENABLED;
		tileset.colorBlendMode = _cs.Cesium3DTileColorBlendMode.HIGHLIGHT;

		try {
			_shader = new C.CustomShader({
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
			tileset.customShader = _shader as unknown as CesiumType.CustomShader;
		} catch (e) {
			console.warn('[Buildings] Custom shader failed:', (e as { message?: string })?.message ?? String(e));
			_shader = null;
		}

		_viewer.scene.primitives.add(tileset);
	} catch (e) { console.warn('[Buildings] OSM unavailable:', (e as Error).message); }
}

export function syncBuildings(
	dt: number, nf: number, scale: number, altFt: number,
	buildingsEnabled: boolean, windowLightIntensity: number, bootFade: number,
): void {
	if (!tileset) return;
	_show.update(buildingsEnabled, (v) => { tileset!.show = v; });

	if (_shader) {
		_time = (_time + dt) % (Math.PI * 4000);
		_shader.setUniform('u_nightFactor', nf * bootFade);
		_shader.setUniform('u_lightIntensity', scale);
		_shader.setUniform('u_windowDensity', (1 - altitudeDetailMix(altFt)) * smoothstep((nf - 0.15) / 0.7) * windowLightIntensity);
		_shader.setUniform('u_time', _time);
		_shader.setUniform('u_cityBrightness', sampleCityBrightness());
		return;
	}

	// Fallback: uniform amber style when shader unavailable.
	_nightFactor.update(nf, (v) => {
		tileset!.style = new _cs.Cesium3DTileStyle({
			color: `color("rgb(255, 200, 50)", ${Math.max(0.3, v * 0.9).toFixed(2)})`,
		});
	});
}

function sampleCityBrightness(): number {
	const now = performance.now();
	if (now - _cityBrightnessTimer < 500) return _cityBrightness;
	_cityBrightnessTimer = now;

	const carto = _viewer?.camera?.positionCartographic;
	if (!carto) return _cityBrightness;
	const C = _cs;
	const lat = C.Math.toDegrees(carto.latitude);
	const lon = C.Math.toDegrees(carto.longitude);
	const field = getViirsField(lat, lon);
	if (!field) return _cityBrightness;

	const STEP_DEG = 0.018;
	let sum = 0, count = 0;
	for (let dy = -1; dy <= 1; dy++)
		for (let dx = -1; dx <= 1; dx++) {
			const s = field.sampleBilinear(lat + dy * STEP_DEG, lon + dx * STEP_DEG);
			if (s > 0) { sum += s; count++; }
		}
	const target = count > 0 ? sum / count : field.sampleBilinear(lat, lon);
	_cityBrightness += (target - _cityBrightness) * 0.3;
	return _cityBrightness;
}

export function setBuildingsWireframe(enabled: boolean): void {
	if (!tileset) return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(tileset as any).debugWireframe = enabled;
}

export function updateBuildingsQuality(maximumScreenSpaceError: number): void {
	if (tileset) tileset.maximumScreenSpaceError = maximumScreenSpaceError;
}
