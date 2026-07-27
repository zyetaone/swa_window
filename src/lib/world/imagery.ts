/**
 * ImageryManager — Cesium imagery layers: base terrain, VIIRS night lights,
 * CartoDB road mask. Extracted from compose.ts.
 *
 * All functions take a Cesium module + viewer reference so they're
 * testable without requiring a full CesiumManager instance.
 */

import type * as CesiumType from 'cesium';
import { world } from '$lib/model/config-tree.svelte';
import { altitudeDetailMix } from '$lib/world/altitude';
import { VIIRS_GIBS_BASE } from '$lib/world/viirs-field';
import {
	getSatelliteImagery,
	TILE_SERVER_URL,
} from '$lib/world/cesium-setup';
import { smoothstep } from '$lib/utils';
import { NIGHT_PALETTE } from '$content/compositions/night';

type WorldConfig = typeof world;

export interface ImageryModel {
	nightFactor: number;
	nightLightScale: number;
	flight: { altitude: number };
	config: {
		world: WorldConfig;
	};
}

export interface ImageryState {
	baseLayer: CesiumType.ImageryLayer | null;
	baseDaySaturation: number;
	baseDayContrast: number;
	viirsLayer: CesiumType.ImageryLayer | null;
	roadMaskLayer: CesiumType.ImageryLayer | null;
	lastNightFactor: number;
	lastViirsAlpha: number;
	lastViirsBrightness: number;
	lastViirsShow: boolean | null;
	lastColorGradeEnabled: boolean | null;
}

export function createImageryState(): ImageryState {
	return {
		baseLayer: null,
		baseDaySaturation: 1.0,
		baseDayContrast: 1.0,
		viirsLayer: null,
		roadMaskLayer: null,
		lastNightFactor: -1,
		lastViirsAlpha: -1,
		lastViirsBrightness: -1,
		lastViirsShow: null,
		lastColorGradeEnabled: null,
	};
}

export async function setupImagery(
	state: ImageryState,
	C: typeof CesiumType,
	viewer: CesiumType.Viewer,
): Promise<void> {
	const cfg = getSatelliteImagery();
	console.info('[Imagery] base imagery:', cfg.label);

	const provider = new C.UrlTemplateImageryProvider({
		url: cfg.url,
		maximumLevel: cfg.maxZoom,
		minimumLevel: 0,
		...(cfg.webMercator ? { tilingScheme: new C.WebMercatorTilingScheme() } : {}),
	});
	state.baseLayer = viewer.imageryLayers.addImageryProvider(provider);
	if (state.baseLayer) {
		state.baseDaySaturation = cfg.label.startsWith('eox') ? 1.4 : 1.15;
		state.baseDayContrast = cfg.label.startsWith('eox') ? 1.2 : 1.05;
		state.baseLayer.saturation = state.baseDaySaturation;
		state.baseLayer.contrast = state.baseDayContrast;
		state.baseLayer.gamma = cfg.label.startsWith('eox') ? 1.05 : 1.0;
		state.baseLayer.brightness = 1.0;
	}

	const tileBase = TILE_SERVER_URL?.replace(/\/$/, '');

	try {
		const cartoUrl = tileBase
			? `${tileBase}/cartodb-dark/{z}/{x}/{y}.png`
			: 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png';
		state.roadMaskLayer = viewer.imageryLayers.addImageryProvider(
			new C.UrlTemplateImageryProvider({
				url: cartoUrl,
				maximumLevel: 18,
				minimumLevel: 0,
				...(tileBase ? { tilingScheme: new C.WebMercatorTilingScheme() } : {}),
			}),
		);
		if (state.roadMaskLayer) {
			state.roadMaskLayer.alpha = 0;
			state.roadMaskLayer.show = false;
			state.roadMaskLayer.dayAlpha = 0;
			state.roadMaskLayer.nightAlpha = 1;
			state.roadMaskLayer.colorToAlpha = C.Color.BLACK;
			state.roadMaskLayer.colorToAlphaThreshold = 0.0;
			state.roadMaskLayer.saturation = 0.0;
			state.roadMaskLayer.contrast = 1.5;
			state.roadMaskLayer.brightness = 1.0;
		}
	} catch (e) {
		console.warn('[Imagery] CartoDB roads layer failed:', e);
	}

	try {
		const viirsUrl = tileBase
			? `${tileBase}/viirs-night-lights/{z}/{y}/{x}.jpg`
			: `${VIIRS_GIBS_BASE}/{z}/{y}/{x}.png`;
		state.viirsLayer = viewer.imageryLayers.addImageryProvider(
			new C.UrlTemplateImageryProvider({
				url: viirsUrl,
				maximumLevel: 8,
				minimumLevel: 3,
				...(tileBase ? { tilingScheme: new C.WebMercatorTilingScheme() } : {}),
			}),
		);
		if (state.viirsLayer) {
			state.viirsLayer.alpha = 0;
			state.viirsLayer.show = false;
			state.viirsLayer.dayAlpha = 0;
			state.viirsLayer.nightAlpha = 1;
			state.viirsLayer.colorToAlpha = C.Color.BLACK;
			state.viirsLayer.hue = 0.0;
			state.viirsLayer.saturation = 0.0;
			state.viirsLayer.brightness = 2.5 * world.viirsBrightness;
			state.viirsLayer.contrast = 0.8;
			state.viirsLayer.colorToAlphaThreshold = 0.01;
		}
	} catch (e) {
		console.warn('[Imagery] VIIRS layer failed:', e);
	}
}

export function syncImagery(state: ImageryState, model: ImageryModel, bootFade: number): void {
	const nf = model.nightFactor;
	const scale = model.nightLightScale;

	const show = nf > 0.01;
	const firstNight = state.lastNightFactor < 0.01 && nf > 0.01;
	state.lastNightFactor = nf;

	const baseEase = smoothstep((nf - 0.45) / (0.9 - 0.45));
	const w = model.config.world;
	if (state.baseLayer) {
		state.baseLayer.saturation = state.baseDaySaturation + (w.baseNightSaturation - state.baseDaySaturation) * baseEase;
	}

	if (state.viirsLayer) {
		const V = NIGHT_PALETTE.viirs;
		const viirsEase = smoothstep(
			(nf - V.smoothstepFloor) / Math.max(V.smoothstepCeil - V.smoothstepFloor, 0.001),
		);
		const altGate = 1 - altitudeDetailMix(model.flight.altitude);
		const boost = 1.0 + (w.viirsAlphaBoost - 1.0) * nf;
		const viirsAlpha = Math.min(V.maxAlpha * viirsEase * scale * altGate * boost, 1.0) * bootFade;
		const viirsShow = (show || firstNight) && viirsAlpha > 0.001;
		const viirsBrightness = 5.0 * w.viirsBrightness;

		if (viirsShow !== state.lastViirsShow) {
			state.viirsLayer.show = viirsShow;
			state.lastViirsShow = viirsShow;
		}
		if (Math.abs(viirsAlpha - state.lastViirsAlpha) > 0.001) {
			state.viirsLayer.alpha = viirsAlpha;
			state.lastViirsAlpha = viirsAlpha;
		}
		if (Math.abs(viirsBrightness - state.lastViirsBrightness) > 0.01) {
			state.viirsLayer.brightness = viirsBrightness;
			state.lastViirsBrightness = viirsBrightness;
		}
	}

	if (state.roadMaskLayer) {
		const roadAltGate = 0.3 + 0.7 * altitudeDetailMix(model.flight.altitude);
		const ROAD_DAY_BASE = 0.08;
		const nightComponent = nf * scale * roadAltGate;
		const dayComponent = (1 - nf) * ROAD_DAY_BASE * roadAltGate;
		state.roadMaskLayer.show = true;
		state.roadMaskLayer.alpha = (nightComponent + dayComponent) * bootFade;
		state.roadMaskLayer.brightness = 1.5 + nf * 1.5;
	}
}
