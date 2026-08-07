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
import { altitudeDetailMix, NIGHT_LIGHT_SCALE_MAX } from '$lib/world/altitude';
import { VIIRS_GIBS_BASE } from '$lib/world/viirs-field';
import { getSatelliteImagery, TILE_SERVER_URL } from '$lib/world/cesium-setup';
import { clamp, smoothstep } from '$lib/utils';
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
/**
 * VIIRS night-lights layer alpha.
 *
 * Pure so the clamp can be tested — the layer itself is module-private and only
 * exists after a networked setupImagery(), which is exactly why the saturation
 * bug below survived: nothing could assert on it without a live viewer.
 *
 * ─── ⚠ THE CEILING IS maxAlpha, NOT 1.0 ─────────────────────────────────────
 * `scale` (the operator's Night Lights knob) and `boost` multiply INTO this, so
 * clamping at 1.0 let them overrun the palette ceiling: at the shipped defaults
 * the product reaches 5.6, pinning alpha fully opaque for every nightFactor
 * past the smoothstep knee, at every altitude. The NASA tiles then read as a
 * flat amber wash rather than lit terrain over shader-darkened ground, and 82%
 * of the slider's 0..5 travel did nothing — with the 5.0 default sitting deep
 * inside that dead zone.
 */
export function viirsLayerAlpha(
	nightFactor: number,
	scale: number,
	altitudeFt: number,
	alphaBoost: number,
	bootFade = 1,
): number {
	const V = NIGHT_PALETTE.viirs;
	const ease = smoothstep(
		(nightFactor - V.smoothstepFloor) / Math.max(V.smoothstepCeil - V.smoothstepFloor, 0.001),
	);
	const altGate = 1 - altitudeDetailMix(altitudeFt);
	const boost = 1.0 + (alphaBoost - 1.0) * nightFactor;
	// `scale` is nightLightIntensity, a 0..5 knob SHARED with the shader uniforms,
	// where a gain of 5 is meaningful. An ALPHA cannot use it raw: at 5 it
	// overruns any ceiling instantly. Normalising against the slider maximum
	// keeps the whole travel expressive instead of pinning at ~0.7 and leaving
	// most of the control inert.
	const gain = clamp(scale / NIGHT_LIGHT_SCALE_MAX, 0, 1);
	// boost lifts the deep-night end; clamp so it cannot push past the ceiling.
	return clamp(V.maxAlpha * ease * gain * altGate * boost, 0, V.maxAlpha) * bootFade;
}

/**
 * CartoDB road-mask layer alpha.
 *
 * Clamped for the same reason as VIIRS: `scale` multiplies in, so at the 5.0
 * default this evaluated to 1.5-3.7 and was assigned with NO clamp at all
 * (observed live: 3.664). Cesium treats >= 1 as fully opaque, so every value
 * above 1 was both meaningless and indistinguishable, and the altitude gate
 * could never actually fade the mask.
 */
export function roadMaskAlpha(
	nightFactor: number,
	scale: number,
	altitudeFt: number,
	bootFade = 1,
): number {
	const gate = 0.3 + 0.7 * altitudeDetailMix(altitudeFt);
	const nf = nightFactor;
	return Math.min(nf * scale * gate + (1 - nf) * 0.08 * gate, 1.0) * bootFade;
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
		const viirsAlpha = viirsLayerAlpha(nf, scale, model.altitude, w.viirsAlphaBoost, bootFade);
		const viirsShow = (show || (prev < 0.01 && nf > 0.01)) && viirsAlpha > 0.001;
		const viirsBrightness = 5.0 * w.viirsBrightness;

		_viirsShow.update(viirsShow, (v) => { _viirsLayer!.show = v; });
		_viirsAlpha.update(viirsAlpha, (v) => { _viirsLayer!.alpha = v; });
		_viirsBrightness.update(viirsBrightness, (v) => { _viirsLayer!.brightness = v; });
	}
	if (_roadMaskLayer) {
		const roadAlpha = roadMaskAlpha(nf, scale, model.altitude, bootFade);
		const roadBrightness = 1.5 + nf * 1.5;
		// ─── ⚠ NOT GATED ON useThreeOverlay ─────────────────────────────────────
		// This used to be `show = !w.useThreeOverlay`, deferring the ground light
		// field to the Three side. Those overlays (CityLightField bokeh,
		// NeonLineLayer) were deleted in 3bf9cf4, and the flag defaults TRUE — so
		// the guard has been switching the road mask OFF in favour of a renderer
		// that draws nothing but clouds and the wing. Confirmed live: the layer sat
		// at show=false on every night frame.
		// Net effect: night cities had no street-grid light at all, just building
		// windows floating over unlit ground, which reads as "too dark".
		// world/three/ has no ground-lighting component; if one is ever added, gate
		// it there rather than reinstating a flag that silently blanks this layer.
		_roadMaskLayer.show = true;
		_roadAlpha.update(roadAlpha, (v) => { _roadMaskLayer!.alpha = v; });
		_roadBrightness.update(roadBrightness, (v) => { _roadMaskLayer!.brightness = v; });
	}
}
