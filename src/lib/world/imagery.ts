/**
 * Imagery — Cesium satellite + VIIRS + CartoDB imagery layers.
 *
 * Owns base terrain imagery, VIIRS night lights, and CartoDB road mask.
 * Setup is async (network). Sync is per-tick with EpsilonGate idempotency.
 *
 * Call lifecycle:
 *   initImagery(C, v)        — once, stores refs
 *   setupImagery()            — once, async, creates 3 imagery layers
 *   syncImagery(model, fade)  — per-tick
 */

import type * as CesiumType from 'cesium';
import { altitudeDetailMix } from '$lib/world/altitude';
import { VIIRS_GIBS_BASE } from '$lib/world/viirs-field';
import { getSatelliteImagery, TILE_SERVER_URL } from '$lib/world/cesium-setup';
import { smoothstep } from '$lib/utils';
import { NIGHT_PALETTE } from '$content/compositions/night';
import { EpsilonGate } from './util';

interface WorldConfig {
	readonly baseNightSaturation: number; readonly viirsAlphaBoost: number; readonly viirsBrightness: number;
	readonly useThreeOverlay: boolean;
}

export interface ImageryTickInput {
	readonly nightFactor: number; readonly nightLightScale: number;
	readonly altitude: number; readonly config: { readonly world: WorldConfig };
}

type C = typeof CesiumType;

let _cs: C;
let _viewer: CesiumType.Viewer;

let _baseLayer: CesiumType.ImageryLayer | null = null;
let _baseDaySaturation = 1.0;
let _viirsLayer: CesiumType.ImageryLayer | null = null;
let _roadMaskLayer: CesiumType.ImageryLayer | null = null;

let _lastNightFactor = -1;
const _viirsShow = new EpsilonGate<boolean>(0, false);
const _viirsAlpha = new EpsilonGate<number>(0.001, -1);
const _viirsBrightness = new EpsilonGate<number>(0.01, -1);
const _roadAlpha = new EpsilonGate<number>(0.001, -1);
const _roadBrightness = new EpsilonGate<number>(0.01, -1);
export function initImagery(Cesium: C, viewer: CesiumType.Viewer): void {
	_cs = Cesium; _viewer = viewer;
	// Drop layer handles from the PREVIOUS viewer. They belong to a viewer
	// that is being (or has been) destroyed; keeping them means setupImagery
	// skips re-adding — `if (_baseLayer)` is truthy — and every later sync
	// writes into layers that are no longer in any scene. Nothing throws, the
	// globe just renders bare.
	_baseLayer = null;
	_viirsLayer = null;
	_roadMaskLayer = null;
	_viirsShow.reset();
	_viirsAlpha.reset();
	_viirsBrightness.reset();
	_roadAlpha.reset();
	_roadBrightness.reset();
	_lastNightFactor = -1;
}

export async function setupImagery(): Promise<void> {
	const C = _cs;
	const cfg = getSatelliteImagery();


	_baseLayer = _addLayer(cfg.url, cfg.maxZoom, 0, cfg.webMercator);
	if (_baseLayer) {
		_baseDaySaturation = cfg.label.startsWith('eox') ? 1.6 : 1.25;
		_baseLayer.saturation = _baseDaySaturation;
		_baseLayer.contrast = cfg.label.startsWith('eox') ? 1.3 : 1.1;
		_baseLayer.gamma = cfg.label.startsWith('eox') ? 1.1 : 1.0;
		_baseLayer.brightness = 1.0;
	}

	const tileBase = TILE_SERVER_URL?.replace(/\/$/, '');

	try {
		_roadMaskLayer = _addLayer(
			tileBase ? `${tileBase}/cartodb-dark/{z}/{x}/{y}.png`
				: 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
			18, 0, !!tileBase,
		);
		if (_roadMaskLayer) {
			_roadMaskLayer.alpha = 0;
			_roadMaskLayer.show = false;
			_roadMaskLayer.dayAlpha = 0;
			_roadMaskLayer.nightAlpha = 1;
			_roadMaskLayer.colorToAlpha = C.Color.BLACK;
			_roadMaskLayer.colorToAlphaThreshold = 0.0;
			_roadMaskLayer.saturation = 0.0;
			_roadMaskLayer.contrast = 1.5;
			_roadMaskLayer.brightness = 1.0;
		}
	} catch (e) { console.warn('[Imagery] CartoDB roads failed:', e); }

	try {
		_viirsLayer = _addLayer(
			tileBase ? `${tileBase}/viirs-night-lights/{z}/{y}/{x}.jpg`
				: `${VIIRS_GIBS_BASE}/{z}/{y}/{x}.png`,
			8, 3, !!tileBase,
		);
		if (_viirsLayer) {
			_viirsLayer.alpha = 0; _viirsLayer.show = false;
			_viirsLayer.dayAlpha = 0; _viirsLayer.nightAlpha = 1;
			_viirsLayer.colorToAlpha = C.Color.BLACK;
			_viirsLayer.hue = 0.0; _viirsLayer.saturation = 0.0;
			_viirsLayer.brightness = 2.5; _viirsLayer.contrast = 0.8;
			_viirsLayer.colorToAlphaThreshold = 0.01;
		}
	} catch (e) { console.warn('[Imagery] VIIRS layer failed:', e); }
}

function _addLayer(url: string, maximumLevel: number, minimumLevel: number, webMercator: boolean): CesiumType.ImageryLayer | null {
	return _viewer.imageryLayers.addImageryProvider(
		new _cs.UrlTemplateImageryProvider({
			url, maximumLevel, minimumLevel,
			...(webMercator ? { tilingScheme: new _cs.WebMercatorTilingScheme() } : {}),
		}),
	);
}
export function syncImagery(model: ImageryTickInput, bootFade: number): void {
	const nf = model.nightFactor;
	const scale = model.nightLightScale;
	const show = nf > 0.01;
	const prev = _lastNightFactor;
	_lastNightFactor = nf;

	const w = model.config.world;

	if (_baseLayer) {
		const baseEase = smoothstep((nf - 0.45) / (0.9 - 0.45));
		_baseLayer.saturation = _baseDaySaturation + (w.baseNightSaturation - _baseDaySaturation) * baseEase;
	}

	if (_viirsLayer) {
		const V = NIGHT_PALETTE.viirs;
		const viirsEase = smoothstep((nf - V.smoothstepFloor) / Math.max(V.smoothstepCeil - V.smoothstepFloor, 0.001));
		const altGate = 1 - altitudeDetailMix(model.altitude);
		const boost = 1.0 + (w.viirsAlphaBoost - 1.0) * nf;
		const viirsAlpha = Math.min(V.maxAlpha * viirsEase * scale * altGate * boost, 1.0) * bootFade;
		const viirsShow = (show || (prev < 0.01 && nf > 0.01)) && viirsAlpha > 0.001;
		const viirsBrightness = 5.0 * w.viirsBrightness;

		_viirsShow.update(viirsShow, (v) => { _viirsLayer!.show = v; });
		_viirsAlpha.update(viirsAlpha, (v) => { _viirsLayer!.alpha = v; });
		_viirsBrightness.update(viirsBrightness, (v) => { _viirsLayer!.brightness = v; });
	}
	if (_roadMaskLayer) {
		const roadAltGate = 0.3 + 0.7 * altitudeDetailMix(model.altitude);
		const roadAlpha = (nf * scale * roadAltGate + (1 - nf) * 0.08 * roadAltGate) * bootFade;
		const roadBrightness = 1.5 + nf * 1.5;
		_roadMaskLayer.show = !w.useThreeOverlay;
		_roadAlpha.update(roadAlpha, (v) => { _roadMaskLayer!.alpha = v; });
		_roadBrightness.update(roadBrightness, (v) => { _roadMaskLayer!.brightness = v; });
	}
}
