/**
 * AtmosphereManager — sky, fog, globe color, moonlight, exposure.
 *
 * Owns the Cesium atmosphere state: scene.skyAtmosphere, scene.fog,
 * globe.baseColor, scene.light (moonlight swap), scene exposure.
 * Per-tick sync is idempotent via epsilon-gated setter calls.
 */

import type * as CesiumType from 'cesium';
import { lerp } from '$lib/utils';
import { NIGHT_PALETTE } from '$content/compositions/night';
import { lightingState } from '$lib/world/curves';

interface WorldAtmosphereConfig {
	skyDarken: number;
	moonlightIntensity: number;
	nightExposure: number;
	atmosphereLight: number;
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

	#lastGlobeColor = '';
	#lastFogDensity = -1;
	#lastFogBrightness = -1;
	#lastLightIntensity = -1;
	#lastSkySatShift = 999;
	#lastSkyBrShift = 999;
	#lastAtmoKilled: boolean | null = null;
	#lastExposure = -1;
	#lastAtmoLight = -1;
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

		// Globe color
		const G = NIGHT_PALETTE.globeColor;
		const r = lerp(lerp(G.day[0], G.night[0], nf), G.duskBias[0], dd * G.duskWeight);
		const g = lerp(lerp(G.day[1], G.night[1], nf), G.duskBias[1], dd * G.duskWeight);
		const b = lerp(lerp(G.day[2], G.night[2], nf), G.duskBias[2], dd * G.duskWeight);
		const colorKey = `${r},${g},${b}`;
		if (colorKey !== this.#lastGlobeColor) {
			this.#lastGlobeColor = colorKey;
			v.scene.globe.baseColor = C.Color.fromBytes(Math.round(r), Math.round(g), Math.round(b), 255);
		}

		// Sky atmosphere saturation/brightness
		const S = NIGHT_PALETTE.skyAtmosphere;
		const satShift = lerp(S.satShift.day, S.satShift.night, nf) + dd * S.satShift.duskBias;
		let brShift = lerp(S.brShift.day, S.brShift.night, nf) * model.config.world.skyDarken + dd * S.brShift.duskBias;

		const camAlt = model.flight.camAlt;
		const lowAltNight = nf * Math.max(0, Math.min(1, (35000 - camAlt) / (35000 - 8000)));
		const deepNight = Math.max(0, Math.min(1, (nf - 0.7) / 0.3));
		brShift += (-1.0 - brShift) * deepNight * 0.6;
		brShift += (-1.0 - brShift) * lowAltNight;

		const satChanged = Math.abs(satShift - this.#lastSkySatShift) > 0.01;
		const brChanged = Math.abs(brShift - this.#lastSkyBrShift) > 0.01;
		if ((satChanged || brChanged) && v.scene.skyAtmosphere) {
			if (satChanged) { v.scene.skyAtmosphere.saturationShift = satShift; this.#lastSkySatShift = satShift; }
			if (brChanged) { v.scene.skyAtmosphere.brightnessShift = brShift; this.#lastSkyBrShift = brShift; }
		}

		// Deep-night atmosphere kill
		const killAtmo = deepNight > 0.6;
		if (killAtmo !== this.#lastAtmoKilled) {
			this.#lastAtmoKilled = killAtmo;
			if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = !killAtmo;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v.scene.globe as any).showGroundAtmosphere = !killAtmo;
		}

		// Fog
		const fog = model.sceneFog;
		const tDensity = lerp(fog.dayDensity, fog.nightDensity, nf) * (1 + model.config.world.atmosphereLight * 0.001);
		const tBright = lerp(fog.dayBrightness, fog.nightBrightness, nf);
		if (Math.abs(tDensity - this.#lastFogDensity) > 0.00001) {
			this.#lastFogDensity = tDensity;
			if (v.scene.fog) {
				v.scene.fog.enabled = tDensity > 0.00001;
				v.scene.fog.density = tDensity;
			}
		}
		if (Math.abs(tBright - this.#lastFogBrightness) > 0.01) {
			this.#lastFogBrightness = tBright;
			if (v.scene.fog) v.scene.fog.minimumBrightness = tBright;
		}

		// Moonlight
		const w = model.config.world;
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
			if (Math.abs(li - this.#lastLightIntensity) > 0.01) {
				this.#lastLightIntensity = li;
				if (v.scene.light) v.scene.light.intensity = li;
			}
		}

		// Exposure + atmosphere light
		const exp = NIGHT_PALETTE.scene.exposureDay + (w.nightExposure - NIGHT_PALETTE.scene.exposureDay) * nf;
		if (Math.abs(exp - this.#lastExposure) > 0.005) {
			this.#lastExposure = exp;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v.scene.postProcessStages as any).exposure = exp;
		}
		const atmo = (NIGHT_PALETTE.scene.atmosphereLightDay + (w.atmosphereLight - NIGHT_PALETTE.scene.atmosphereLightDay) * nf)
			* (1 - lowAltNight * 0.9) * (1 - deepNight * 0.55);
		if (Math.abs(atmo - this.#lastAtmoLight) > 0.005) {
			this.#lastAtmoLight = atmo;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v.scene.globe as any).atmosphereLightIntensity = atmo;
		}
	}
}
