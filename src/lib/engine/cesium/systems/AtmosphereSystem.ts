import type * as CesiumType from 'cesium';
import { lerp } from '$lib/shared/utils';
import type { CesiumModelView } from '../manager';

export class AtmosphereSystem {
	private readonly viewer: CesiumType.Viewer;
	private readonly C: typeof CesiumType;
	private readonly model: CesiumModelView;

	private lastGlobeColor = '';
	private lastFogDensity = -1;
	private lastFogBrightness = -1;
	private lastLightIntensity = -1;
	private lastSkySatShift = 999;
	private lastTimeOfDay = -1;

	constructor(viewer: CesiumType.Viewer, C: typeof CesiumType, model: CesiumModelView) {
		this.viewer = viewer;
		this.C = C;
		this.model = model;
	}

	sync(timeOfDay: number): void {
		const v = this.viewer;
		const m = this.model;
		const C = this.C;
		const nf = m.nightFactor;
		const dd = m.dawnDuskFactor;

		// ── Sun visibility from time of day ────────────────────────────────
		// Show sun during daylight hours only (6am–8pm). Cesium's internal
		// clock handles the sun's actual position in the sky.
		const isSunVisible = timeOfDay > 6 && timeOfDay < 20;
		if (this.lastTimeOfDay !== timeOfDay) {
			this.lastTimeOfDay = timeOfDay;
			if (v.scene.sun) v.scene.sun.show = isSunVisible;
		}
		let r = lerp(140, 25, nf);
		let g = lerp(170, 25, nf);
		let b = lerp(200, 40, nf);
		r = lerp(r, 100, dd * 0.3);
		g = lerp(g, 80, dd * 0.3);
		b = lerp(b, 70, dd * 0.3);
		const colorKey = `${r},${g},${b}`;
		if (colorKey !== this.lastGlobeColor) {
			this.lastGlobeColor = colorKey;
			v.scene.globe.baseColor = C.Color.fromBytes(Math.round(r), Math.round(g), Math.round(b), 255);
		}

		// Sky atmosphere saturation
		const satShift = lerp(0, -0.8, nf) + dd * 0.2;
		if (Math.abs(satShift - this.lastSkySatShift) > 0.01) {
			this.lastSkySatShift = satShift;
			if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.saturationShift = satShift;
		}

		// Fog
		const dayDens = 0.0;
		const nightDens = 0.00008;
		const hazeMultiplier = 1 + m.haze * 8;
		const targetDensity = lerp(dayDens, nightDens, m.nightFactor) * hazeMultiplier;
		const targetBrightness = lerp(1.0, 0.1, m.nightFactor);
		if (Math.abs(targetDensity - this.lastFogDensity) > 0.00001) {
			this.lastFogDensity = targetDensity;
			if (v.scene.fog) {
				v.scene.fog.enabled = targetDensity > 0.00001;
				v.scene.fog.density = targetDensity;
			}
		}
		if (Math.abs(targetBrightness - this.lastFogBrightness) > 0.01) {
			this.lastFogBrightness = targetBrightness;
			if (v.scene.fog) v.scene.fog.minimumBrightness = targetBrightness;
		}

		// Directional light
		const targetIntensity = lerp(1.0, 0.02, nf);
		if (Math.abs(targetIntensity - this.lastLightIntensity) > 0.01) {
			this.lastLightIntensity = targetIntensity;
			if (v.scene.light) v.scene.light.intensity = targetIntensity;
		}
	}
}
