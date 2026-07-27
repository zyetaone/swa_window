/**
 * world/rules — Night rendering formulas (MRAX: Rules layer).
 *
 * Pure functions of config + state → derived values. No Cesium dependency,
 * no DOM, no side effects. One source of truth for every alpha, gate, ramp,
 * and color blend used by the night render pipeline.
 */
import { smoothstep } from '$lib/utils';
import { altitudeDetailMix } from './altitude';
import type { NIGHT_PALETTE } from '$content/compositions/night';


/** VIIRS alpha — smoothstep on nightFactor × altitude gate × alpha boost. */
export function viirsAlpha(
	nf: number, scale: number, altFt: number,
	palette: typeof NIGHT_PALETTE, viirsAlphaBoost: number,
): number {
	const V = palette.viirs;
	const viirsEase = smoothstep((nf - V.smoothstepFloor) / Math.max(V.smoothstepCeil - V.smoothstepFloor, 0.001));
	const altGate = 1 - altitudeDetailMix(altFt);
	const boost = 1.0 + (viirsAlphaBoost - 1.0) * nf;
	return Math.min(V.maxAlpha * viirsEase * scale * altGate * boost, 1.0);
}

/** VIIRS brightness — base multiplier × config value. */
export function viirsBrightness(viirsBrightnessVal: number): number { return 5.0 * viirsBrightnessVal; }

/** Building window density — dusk ramp × config × altitude fade. */
export function buildingWindowDensity(nf: number, windowLightIntensity: number, altFt: number): number {
	const duskRamp = smoothstep((nf - 0.15) / 0.7);
	const altFade = 1 - altitudeDetailMix(altFt);
	return 1.0 * duskRamp * windowLightIntensity * altFade;
}
