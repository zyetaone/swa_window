/**
 * Atmosphere — sky, fog, globe color, moonlight, exposure.
 *
 * Owns the Cesium atmosphere state: scene.skyAtmosphere, scene.fog,
 * globe.baseColor, scene.light (moonlight swap), scene exposure.
 * Per-tick sync is idempotent via EpsilonGate.
 *
 * Call lifecycle:
 *   initAtmosphere(C, v)       — once, snapshots original light, creates moonlight
 *   syncAtmosphere(model, ct)  — per-tick
 */

import type * as CesiumType from 'cesium';
import { lerp } from '$lib/utils';
import { NIGHT_PALETTE } from '$content/compositions/night';
import { lightingState } from '$lib/world/curves';
import { EpsilonGate } from './util';

interface AtmosphereConfigSlice {
	skyDarken: number; moonlightIntensity: number; nightExposure: number;
	atmosphereLight: number; ambientOcclusion: boolean; qualityMode: string;
}

export interface AtmosphereModel {
	timeOfDay: number; nightFactor: number; dawnDuskFactor: number;
	flight: { lon: number; camAlt: number };
	config: { world: AtmosphereConfigSlice };
	/**
	 * `atmosphere.haze.amount` (0..0.15). Flattened onto the slice rather
	 * than nested: haze lives in the ATMOSPHERE namespace, not `world`, so
	 * reading it off `config.world` silently yields undefined and the haze
	 * slider stops driving fog at all.
	 */
	hazeAmount: number;
	sceneFog: { dayDensity: number; nightDensity: number; dayBrightness: number; nightBrightness: number };
}

type C = typeof CesiumType;

let _cs: C;
let _viewer: CesiumType.Viewer;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _moonlight: any = null, _originalSunLight: any = null;
let _isUsingMoonlight = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sunPos: any = null, _moonPos: any = null, _earthToMoon: any = null, _moonToSun: any = null;

const _globeColor = new EpsilonGate<string>(0, '');
const _fogDensity = new EpsilonGate<number>(0.00001, -1);
const _fogVisualScalar = new EpsilonGate<number>(0.005, -1);
const _fogBrightness = new EpsilonGate<number>(0.01, -1);
const _lightIntensity = new EpsilonGate<number>(0.01, -1);
const _skySatShift = new EpsilonGate<number>(0.01, 999);
const _skyBrShift = new EpsilonGate<number>(0.01, 999);
const _atmoKilled = new EpsilonGate<boolean>(0, false);
const _exposure = new EpsilonGate<number>(0.005, -1);
const _atmoLight = new EpsilonGate<number>(0.005, -1);

let _moonPhaseTime = -1;
let _moonPhaseCache = 1.0;

let _lastTimeOfDay = -1;
let _lastClockLon = -999;

export function getLastTimeOfDay(): number { return _lastTimeOfDay; }
export function setLastTimeOfDay(v: number): void { _lastTimeOfDay = v; }
export function getLastClockLon(): number { return _lastClockLon; }
export function setLastClockLon(v: number): void { _lastClockLon = v; }
export function initAtmosphere(Cesium: C, viewer: CesiumType.Viewer): void {
	_cs = Cesium; _viewer = viewer;
	_globeColor.reset();
	_fogDensity.reset();
	_fogBrightness.reset();
	_lightIntensity.reset();
	_skySatShift.reset();
	_skyBrShift.reset();
	_atmoKilled.reset();
	_exposure.reset();
	_atmoLight.reset();
	_fogVisualScalar.reset();
	// Not a gate, but the same re-init class: if the old viewer died at deep
	// night with moonlight active, a stuck `true` keeps the moonlight branch
	// from ever attaching to the fresh scene and the night globe renders
	// day-lit until nf < 0.65 self-heals.
	_isUsingMoonlight = false;
	_originalSunLight = viewer.scene.light;
	_moonlight = new Cesium.DirectionalLight({
		direction: new Cesium.Cartesian3(0, 0, -1),
		color: new Cesium.Color(0.95, 0.88, 0.78, 1.0), intensity: 0.0,
	});
	_sunPos = new Cesium.Cartesian3();
	_moonPos = new Cesium.Cartesian3();
	_earthToMoon = new Cesium.Cartesian3(0, 0, -1);
	_moonToSun = new Cesium.Cartesian3();
}

export function syncAtmosphere(model: AtmosphereModel, clockTime: CesiumType.JulianDate): void {
	const { timeOfDay: t, nightFactor: nf } = model;
	const v = _viewer; const C = _cs;
	const dd = lightingState(t, nf).dawnDuskWeight;
	const w = model.config.world;

	const G = NIGHT_PALETTE.globeColor;
	const r = lerp(lerp(G.day[0], G.night[0], nf), G.duskBias[0], dd * G.duskWeight);
	const g = lerp(lerp(G.day[1], G.night[1], nf), G.duskBias[1], dd * G.duskWeight);
	const b = lerp(lerp(G.day[2], G.night[2], nf), G.duskBias[2], dd * G.duskWeight);
	_globeColor.update(`${r},${g},${b}`, () => {
		v.scene.globe.baseColor = C.Color.fromBytes(Math.round(r), Math.round(g), Math.round(b), 255);
	});

	const S = NIGHT_PALETTE.skyAtmosphere;
	const satShift = lerp(S.satShift.day, S.satShift.night, nf) + dd * S.satShift.duskBias;
	let brShift = lerp(S.brShift.day, S.brShift.night, nf) * w.skyDarken + dd * S.brShift.duskBias;

	const camAlt = model.flight.camAlt;
	const lowAltNight = nf * Math.max(0, Math.min(1, (35000 - camAlt) / (35000 - 8000)));
	const deepNight = Math.max(0, Math.min(1, (nf - 0.7) / 0.3));
	brShift += (-1.0 - brShift) * deepNight * 0.6;
	brShift += (-1.0 - brShift) * lowAltNight;

	_skySatShift.update(satShift, (val) => { if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.saturationShift = val; });
	_skyBrShift.update(brShift, (val) => { if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.brightnessShift = val; });
	const killAtmo = deepNight > 0.6;
	_atmoKilled.update(killAtmo, (val) => {
		if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = !val;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.globe as any).showGroundAtmosphere = !val;
	});

	const fog = model.sceneFog;
	const haze = model.hazeAmount;
	const tDensity = lerp(fog.dayDensity, fog.nightDensity, nf) * (1 + haze * 8);
	const tBright = lerp(fog.dayBrightness, fog.nightBrightness, nf);
	_fogDensity.update(tDensity, (val) => {
		if (v.scene.fog) { v.scene.fog.enabled = val > 0.00001; v.scene.fog.density = val; }
	});
	// Per-pass visual density — sharper at night, plus an additive haze boost.
	_fogVisualScalar.update(1 + 0.9 * nf + haze * 4, (val) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		if (v.scene.fog) (v.scene.fog as any).visualDensityScalar = val;
	});
	_fogBrightness.update(tBright, (val) => { if (v.scene.fog) v.scene.fog.minimumBrightness = val; });
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const Cany = C as any;
	if (_moonPhaseTime !== t) {
		_moonPhaseTime = t;
		try {
			Cany.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(clockTime, _sunPos);
			Cany.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(clockTime, _moonPos);
			C.Cartesian3.normalize(_moonPos, _earthToMoon);
			C.Cartesian3.subtract(_sunPos, _moonPos, _moonToSun);
			C.Cartesian3.normalize(_moonToSun, _moonToSun);
			_moonPhaseCache = (1.0 - C.Cartesian3.dot(_earthToMoon, _moonToSun)) * 0.5;
		} catch { /* keep last cached phase */ }
	}

	const phaseFactor = 0.7 + 0.3 * _moonPhaseCache;
	const moonIntensity = nf > 0.01 ? Math.max(w.moonlightIntensity * nf * phaseFactor, 0.035) : 0;

	if (nf > 0.85 && !_isUsingMoonlight) { v.scene.light = _moonlight; _isUsingMoonlight = true; }
	else if (nf < 0.65 && _isUsingMoonlight) { v.scene.light = _originalSunLight; _isUsingMoonlight = false; }

	if (_isUsingMoonlight && _moonlight) {
		_moonlight.intensity = moonIntensity;
		C.Cartesian3.negate(_earthToMoon, _moonlight.direction);
	} else {
		const li = lerp(1.0, 0.02, nf);
		_lightIntensity.update(li, (val) => { if (v.scene.light) v.scene.light.intensity = val; });
	}

	const exp = NIGHT_PALETTE.scene.exposureDay + (w.nightExposure - NIGHT_PALETTE.scene.exposureDay) * nf;
	_exposure.update(exp, (val) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.postProcessStages as any).exposure = val;
	});

	const atmo = (NIGHT_PALETTE.scene.atmosphereLightDay + (w.atmosphereLight - NIGHT_PALETTE.scene.atmosphereLightDay) * nf)
		* (1 - lowAltNight * 0.9) * (1 - deepNight * 0.55);
	_atmoLight.update(atmo, (val) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.globe as any).atmosphereLightIntensity = val;
	});

	const ao = v.scene.postProcessStages.ambientOcclusion;
	if (ao) {
		ao.enabled = w.ambientOcclusion && w.qualityMode !== 'performance' && camAlt < 15_000;
	}
}
