/**
 * AtmosphereManager — sky, fog, globe color, moonlight, exposure.
 *
 * Owns the Cesium atmosphere state: scene.skyAtmosphere, scene.fog,
 * globe.baseColor, scene.light (moonlight swap), scene exposure.
 * Per-tick sync is idempotent via EpsilonGate.
 */

import type * as CesiumType from 'cesium';
import { lerp } from '$lib/utils';
import { NIGHT_PALETTE } from '$content/compositions/night';
import { lightingState } from '$lib/world/curves';
import { EpsilonGate } from './util';

interface WorldAtmosphereConfig {
	skyDarken: number;
	moonlightIntensity: number;
	nightExposure: number;
	atmosphereLight: number;
	ambientOcclusion: boolean;
	qualityMode: string;
}

interface AtmosphereModel {
	timeOfDay: number; nightFactor: number; dawnDuskFactor: number;
	flight: { lon: number; camAlt: number };
	config: { world: WorldAtmosphereConfig };
	sceneFog: { dayDensity: number; nightDensity: number; dayBrightness: number; nightBrightness: number };
}

type C = typeof CesiumType;

export class AtmosphereManager {
	readonly #C: C;
	readonly #viewer: CesiumType.Viewer;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#moonlight: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#originalSunLight: any = null;
	#isUsingMoonlight = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#sunPos: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#moonPos: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#earthToMoon: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#moonToSun: any = null;

	#globeColor = new EpsilonGate<string>(0, '');
	#fogDensity = new EpsilonGate<number>(0.00001, -1);
	#fogBrightness = new EpsilonGate<number>(0.01, -1);
	#lightIntensity = new EpsilonGate<number>(0.01, -1);
	#skySatShift = new EpsilonGate<number>(0.01, 999);
	#skyBrShift = new EpsilonGate<number>(0.01, 999);
	#atmoKilled = new EpsilonGate<boolean>(0, false);
	#exposure = new EpsilonGate<number>(0.005, -1);
	#atmoLight = new EpsilonGate<number>(0.005, -1);
	#moonPhaseTime = -1;
	#moonPhaseCache = 1.0;

	// Clock-state fields (read/written by outside syncClock caller).
	lastTimeOfDay = -1;
	lastClockLon = -999;

	constructor(Cesium: C, viewer: CesiumType.Viewer) {
		this.#C = Cesium;
		this.#viewer = viewer;
	}

	/** One-time setup — snapshot original light, build moonlight. */
	init(C: C, v: CesiumType.Viewer): void {
		this.#originalSunLight = v.scene.light;
		this.#moonlight = new C.DirectionalLight({
			direction: new C.Cartesian3(0, 0, -1),
			color: new C.Color(0.95, 0.88, 0.78, 1.0),
			intensity: 0.0,
		});
		this.#sunPos = new C.Cartesian3();
		this.#moonPos = new C.Cartesian3();
		this.#earthToMoon = new C.Cartesian3(0, 0, -1);
		this.#moonToSun = new C.Cartesian3();
	}

	/** Per-tick atmosphere sync. Clock must be synced externally. */
	sync(model: AtmosphereModel, clockTime: CesiumType.JulianDate): void {
		const { timeOfDay: t, nightFactor: nf } = model;
		const v = this.#viewer;
		const C = this.#C;
		const dd = lightingState(t, nf).dawnDuskWeight;
		const w = model.config.world;

		// Globe color
		const G = NIGHT_PALETTE.globeColor;
		const r = lerp(lerp(G.day[0], G.night[0], nf), G.duskBias[0], dd * G.duskWeight);
		const g = lerp(lerp(G.day[1], G.night[1], nf), G.duskBias[1], dd * G.duskWeight);
		const b = lerp(lerp(G.day[2], G.night[2], nf), G.duskBias[2], dd * G.duskWeight);
		this.#globeColor.update(`${r},${g},${b}`, () => {
			v.scene.globe.baseColor = C.Color.fromBytes(Math.round(r), Math.round(g), Math.round(b), 255);
		});

		// Sky atmosphere saturation/brightness
		const S = NIGHT_PALETTE.skyAtmosphere;
		const satShift = lerp(S.satShift.day, S.satShift.night, nf) + dd * S.satShift.duskBias;
		let brShift = lerp(S.brShift.day, S.brShift.night, nf) * w.skyDarken + dd * S.brShift.duskBias;

		const camAlt = model.flight.camAlt;
		const lowAltNight = nf * Math.max(0, Math.min(1, (35000 - camAlt) / (35000 - 8000)));
		const deepNight = Math.max(0, Math.min(1, (nf - 0.7) / 0.3));
		brShift += (-1.0 - brShift) * deepNight * 0.6;
		brShift += (-1.0 - brShift) * lowAltNight;

		this.#skySatShift.update(satShift, (val) => { if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.saturationShift = val; });
		this.#skyBrShift.update(brShift, (val) => { if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.brightnessShift = val; });

		// Deep-night atmosphere kill
		const killAtmo = deepNight > 0.6;
		this.#atmoKilled.update(killAtmo, (val) => {
			if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = !val;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v.scene.globe as any).showGroundAtmosphere = !val;
		});

		// Fog
		const fog = model.sceneFog;
		const tDensity = lerp(fog.dayDensity, fog.nightDensity, nf) * (1 + w.atmosphereLight * 0.001);
		const tBright = lerp(fog.dayBrightness, fog.nightBrightness, nf);
		this.#fogDensity.update(tDensity, (val) => {
			if (v.scene.fog) {
				v.scene.fog.enabled = val > 0.00001;
				v.scene.fog.density = val;
			}
		});
		this.#fogBrightness.update(tBright, (val) => { if (v.scene.fog) v.scene.fog.minimumBrightness = val; });

		// Moonlight
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const Cany = C as any;
		if (this.#moonPhaseTime !== t) {
			this.#moonPhaseTime = t;
			try {
				Cany.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(clockTime, this.#sunPos);
				Cany.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(clockTime, this.#moonPos);
				C.Cartesian3.normalize(this.#moonPos, this.#earthToMoon);
				C.Cartesian3.subtract(this.#sunPos, this.#moonPos, this.#moonToSun);
				C.Cartesian3.normalize(this.#moonToSun, this.#moonToSun);
				this.#moonPhaseCache = (1.0 - C.Cartesian3.dot(this.#earthToMoon, this.#moonToSun)) * 0.5;
			} catch { /* keep last cached phase */ }
		}

		const phaseFactor = 0.7 + 0.3 * this.#moonPhaseCache;
		const moonIntensity = nf > 0.01 ? Math.max(w.moonlightIntensity * nf * phaseFactor, 0.035) : 0;

		if (nf > 0.85 && !this.#isUsingMoonlight) { v.scene.light = this.#moonlight; this.#isUsingMoonlight = true; }
		else if (nf < 0.65 && this.#isUsingMoonlight) { v.scene.light = this.#originalSunLight; this.#isUsingMoonlight = false; }

		if (this.#isUsingMoonlight && this.#moonlight) {
			this.#moonlight.intensity = moonIntensity;
			C.Cartesian3.negate(this.#earthToMoon, this.#moonlight.direction);
		} else {
			const li = lerp(1.0, 0.02, nf);
			this.#lightIntensity.update(li, (val) => { if (v.scene.light) v.scene.light.intensity = val; });
		}

		// Exposure + atmosphere light
		const exp = NIGHT_PALETTE.scene.exposureDay + (w.nightExposure - NIGHT_PALETTE.scene.exposureDay) * nf;
		this.#exposure.update(exp, (val) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v.scene.postProcessStages as any).exposure = val;
		});

		const atmo = (NIGHT_PALETTE.scene.atmosphereLightDay + (w.atmosphereLight - NIGHT_PALETTE.scene.atmosphereLightDay) * nf)
			* (1 - lowAltNight * 0.9) * (1 - deepNight * 0.55);
		this.#atmoLight.update(atmo, (val) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v.scene.globe as any).atmosphereLightIntensity = val;
			});

			// HBAO — only below 15 000 ft where buildings are visible, and only
			// when quality permits. At cruise the check costs a boolean compare.
			const ao = v.scene.postProcessStages.ambientOcclusion;
			if (ao) {
				const shouldEnable = w.ambientOcclusion
					&& w.qualityMode !== 'performance'
					&& camAlt < 15_000;
				ao.enabled = shouldEnable;
			}
		}
}
