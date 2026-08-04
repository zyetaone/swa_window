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
import { smoothstep } from '$lib/utils';
import { altitudeDetailMix } from '$lib/world/altitude';
import { enableNightIbl } from './night-ibl';
import { CESIUM_QUALITY_PRESETS } from './cesium-setup';
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
	// Same reason as imagery: the tileset + custom shader belong to the
	// previous viewer's scene. Holding them past a remount makes syncBuildings
	// push uniforms into a primitive no longer attached to anything.
	tileset = null;
	_shader = null;
	// Gates are module-level singletons but the VIEWER is not: on remount
	// (auto-retry, HMR, page nav) the fresh viewer has Cesium defaults while
	// the gates still hold the previous viewer's last-written values, so the
	// first sync sees "unchanged" and skips applying them. Same fix as
	// atmosphere/imagery.
	_show.reset();
	_nightFactor.reset();
}

const BUILDING_VERTEX_GLSL = `
	void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
		v_normalMC = vsInput.attributes.normalMC;
	}
`;

const BUILDING_SHADER_GLSL = `
	void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
		vec3 normal = normalize(v_normalMC);

		// Surface orientation detection
		float upDot = abs(dot(normal, vec3(0.0, 0.0, 1.0)));
		float isWall = smoothstep(0.3, 0.7, 1.0 - upDot);
		float isRoof = smoothstep(0.7, 0.9, upDot);

		vec3 wp = fsInput.attributes.positionMC;
		float buildingHeight = wp.z;
		float floorHeight = 3.0;
		float floorIndex = floor(wp.z / floorHeight);
		float isGroundFloor = step(floorIndex, 0.5);

		// Height-based window density: taller buildings = more lit (office towers).
		float heightFactor = smoothstep(10.0, 80.0, buildingHeight);

		// District gate from VIIRS. Scales HOW MANY windows are lit rather than
		// how bright each one is — the physical difference between a sparse
		// outer district and a dense core is occupancy, not bulb wattage.
		// Floored at 0.35: a building with every window dark reads as derelict
		// rather than quiet, and OSM footprints exist in places VIIRS calls
		// near-black. Ceiling stays 1.0 so a metro core is unchanged from
		// before this gate existed.
		float cityMix = mix(0.35, 1.0, u_cityBrightness);
		float adjustedDensity = mix(u_windowDensity * 0.4, u_windowDensity * 1.3, heightFactor) * cityMix;

		// In-plane horizontal coordinate for the window grid. Walls whose
		// normal points along ±X vary in Y across the face (and vice versa);
		// the Feb-15 recipe used wp.x unconditionally, which collapsed
		// X-facing walls into featureless floor-bands (gridUV.x constant
		// across the face). Pure position+normal selection — still fully
		// deterministic across the 3-Pi fleet (invariant #4).
		float facingX = step(abs(normal.y), abs(normal.x));
		float horiz = mix(wp.x, wp.y, facingX);

		// Window grid pattern
		float windowWidth = mix(0.55, 0.8, isGroundFloor);
		float windowHeight = mix(0.65, 0.85, isGroundFloor);
		vec2 gridUV = fract(vec2(horiz * 0.12, wp.z / floorHeight));
		float windowX = smoothstep(0.5 - windowWidth * 0.5, 0.5 - windowWidth * 0.5 + 0.05, gridUV.x)
		             * smoothstep(0.5 + windowWidth * 0.5, 0.5 + windowWidth * 0.5 - 0.05, gridUV.x);
		float windowY = smoothstep(0.5 - windowHeight * 0.5, 0.5 - windowHeight * 0.5 + 0.05, gridUV.y)
		             * smoothstep(0.5 + windowHeight * 0.5, 0.5 + windowHeight * 0.5 - 0.05, gridUV.y);
		float windowMask = windowX * windowY;

		// Per-window random (hash from cell position)
		vec2 cellId = vec2(floor(horiz * 0.12), floorIndex);
		float rand = fract(sin(dot(cellId, vec2(127.1, 311.7))) * 43758.5453);

		// Floor-level randomization (some whole floors dark = empty offices)
		float floorRand = fract(sin(floorIndex * 131.7) * 43758.5453);
		float floorLit = step(0.2, floorRand);
		float fullyLitFloor = step(0.93, floorRand); // ~7% of floors fully lit

		float lit = step(1.0 - adjustedDensity, rand) * floorLit;
		lit = max(lit, fullyLitFloor); // fully lit floors override

		// Window color variation (5 types)
		float colorMix = fract(sin(dot(cellId, vec2(269.5, 183.3))) * 7461.7);
		// Palette: white/warm-white dominant (60%), gold accents (25%), cool blue (15%).
		vec3 warmColor   = vec3(1.0, 0.75, 0.35);   // warm amber residential
		vec3 coolColor   = vec3(1.0, 0.88, 0.55);   // warm gold office
		vec3 retailColor = vec3(1.0, 0.82, 0.45);   // amber retail
		vec3 screenColor = vec3(0.9, 0.85, 0.6);    // warm screen glow
		vec3 officeWhite = vec3(1.0, 0.94, 0.78);   // warm white (never pure)
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
		vec3 streetLampColor = vec3(1.0, 0.72, 0.28); // classic HPS lamp — deeper amber

		// Rooftop aviation warning lights (tall buildings only, slow blink)
		float isTall = smoothstep(30.0, 50.0, buildingHeight);
		float blink = step(0.4, fract(u_time * 0.5));
		float rooftopLight = isRoof * isTall * blink;
		vec3 aviationRed = vec3(1.0, 0.08, 0.03);

		// Build the window emission: lit windows + street-level ambient + aviation lights.
		vec3 emission = (windowColor * windowBright * flicker * lit) * u_lightIntensity
			+ streetLampColor * streetGlow * u_nightFactor
			+ aviationRed * rooftopLight * u_nightFactor;

		// Darken building surfaces at night so emissive reads cleanly.
		material.diffuse *= mix(1.0, 0.06, u_nightFactor);
		material.emissive = emission * u_nightFactor;
	}
`;

export async function setupBuildings(
	buildingsEnabled: boolean,
	useDynamicEnvironmentMap = false,
): Promise<void> {
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

		// Opt-in night IBL (see world/night-ibl.ts). Default-off, and a no-op on
		// a Cesium build without the API, so this cannot change today's look
		// until the flag is turned on deliberately.
		if (useDynamicEnvironmentMap) {
			const ok = enableNightIbl(_cs, tileset);
			console.info(`[Buildings] dynamic environment map: ${ok ? 'enabled' : 'unavailable'}`);
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
