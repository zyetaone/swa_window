/**
 * ImageryManager — ES6 class for Cesium imagery layers.
 *
 * Owns base terrain imagery, VIIRS night lights, and CartoDB road mask.
 * Setup is async (per-tick sync is sync). All writes are idempotent
 * via EpsilonGate to avoid per-frame GPU uniform uploads.
 */

import type * as CesiumType from 'cesium';
import { altitudeDetailMix } from '$lib/world/altitude';
import { VIIRS_GIBS_BASE } from '$lib/world/viirs-field';
import { getSatelliteImagery, TILE_SERVER_URL } from '$lib/world/cesium-setup';
import { smoothstep } from '$lib/utils';
import { NIGHT_PALETTE } from '$content/compositions/night';
import { EpsilonGate } from './util';

interface WorldConfig {
	readonly baseNightSaturation: number;
	readonly viirsAlphaBoost: number;
	readonly viirsBrightness: number;
}

interface ImageryTickInput {
	readonly nightFactor: number;
	readonly nightLightScale: number;
	readonly altitude: number;
	readonly config: { readonly world: WorldConfig };
}

type C = typeof CesiumType;

export class ImageryManager {
	readonly #C: C;
	readonly #viewer: CesiumType.Viewer;

	#baseLayer: CesiumType.ImageryLayer | null = null;
	#baseDaySaturation = 1.0;
	#viirsLayer: CesiumType.ImageryLayer | null = null;
	#roadMaskLayer: CesiumType.ImageryLayer | null = null;

	// Idempotency caches — skip Cesium setter calls when value unchanged.
	#lastNightFactor = -1;
	#viirsShow = new EpsilonGate<boolean>(0, false);
	#viirsAlpha = new EpsilonGate<number>(0.001, -1);
	#viirsBrightness = new EpsilonGate<number>(0.01, -1);
	#roadAlpha = new EpsilonGate<number>(0.001, -1);
	#roadBrightness = new EpsilonGate<number>(0.01, -1);

	constructor(Cesium: C, viewer: CesiumType.Viewer) {
		this.#C = Cesium;
		this.#viewer = viewer;
	}

	// ── Setup ────────────────────────────────────────────────────────────────

	async setup(): Promise<void> {
		const C = this.#C;
		const cfg = getSatelliteImagery();
		console.info('[Imagery] base:', cfg.label);

		this.#baseLayer = this.#addLayer(cfg.url, cfg.maxZoom, 0, cfg.webMercator);
		if (this.#baseLayer) {
			this.#baseDaySaturation = cfg.label.startsWith('eox') ? 1.4 : 1.15;
			this.#baseLayer.saturation = this.#baseDaySaturation;
			this.#baseLayer.contrast = cfg.label.startsWith('eox') ? 1.2 : 1.05;
			this.#baseLayer.gamma = cfg.label.startsWith('eox') ? 1.05 : 1.0;
			this.#baseLayer.brightness = 1.0;
		}

		const tileBase = TILE_SERVER_URL?.replace(/\/$/, '');

		try {
			this.#roadMaskLayer = this.#addLayer(
				tileBase
					? `${tileBase}/cartodb-dark/{z}/{x}/{y}.png`
					: 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
				18, 0, !!tileBase,
			);
			if (this.#roadMaskLayer) {
				this.#roadMaskLayer.alpha = 0;
				this.#roadMaskLayer.show = false;
				this.#roadMaskLayer.dayAlpha = 0;
				this.#roadMaskLayer.nightAlpha = 1;
				this.#roadMaskLayer.colorToAlpha = C.Color.BLACK;
				this.#roadMaskLayer.colorToAlphaThreshold = 0.0;
				this.#roadMaskLayer.saturation = 0.0;
				this.#roadMaskLayer.contrast = 1.5;
				this.#roadMaskLayer.brightness = 1.0;
			}
		} catch (e) { console.warn('[Imagery] CartoDB roads failed:', e); }

		try {
			this.#viirsLayer = this.#addLayer(
				tileBase
					? `${tileBase}/viirs-night-lights/{z}/{y}/{x}.jpg`
					: `${VIIRS_GIBS_BASE}/{z}/{y}/{x}.png`,
				8, 3, !!tileBase,
			);
			if (this.#viirsLayer) {
				this.#viirsLayer.alpha = 0;
				this.#viirsLayer.show = false;
				this.#viirsLayer.dayAlpha = 0;
				this.#viirsLayer.nightAlpha = 1;
				this.#viirsLayer.colorToAlpha = C.Color.BLACK;
				this.#viirsLayer.hue = 0.0;
				this.#viirsLayer.saturation = 0.0;
				this.#viirsLayer.brightness = 2.5;
				this.#viirsLayer.contrast = 0.8;
				this.#viirsLayer.colorToAlphaThreshold = 0.01;
			}
		} catch (e) { console.warn('[Imagery] VIIRS layer failed:', e); }
	}

	/** Wrap UrlTemplateImageryProvider construction — common URL template + WebMercator scheme. */
	#addLayer(url: string, maximumLevel: number, minimumLevel: number, webMercator: boolean): CesiumType.ImageryLayer | null {
		return this.#viewer.imageryLayers.addImageryProvider(
			new this.#C.UrlTemplateImageryProvider({
				url, maximumLevel, minimumLevel,
				...(webMercator ? { tilingScheme: new this.#C.WebMercatorTilingScheme() } : {}),
			}),
		);
	}

	// ── Per-tick sync ────────────────────────────────────────────────────────

	sync(model: ImageryTickInput, bootFade: number): void {
		const nf = model.nightFactor;
		const scale = model.nightLightScale;
		const show = nf > 0.01;
		const firstNight = this.#lastNightFactor < 0.01 && nf > 0.01;
		this.#lastNightFactor = nf;

		const baseEase = smoothstep((nf - 0.45) / (0.9 - 0.45));
		const w = model.config.world;
		if (this.#baseLayer) {
			this.#baseLayer.saturation =
				this.#baseDaySaturation + (w.baseNightSaturation - this.#baseDaySaturation) * baseEase;
		}

		if (this.#viirsLayer) {
			const V = NIGHT_PALETTE.viirs;
			const viirsEase = smoothstep(
				(nf - V.smoothstepFloor) / Math.max(V.smoothstepCeil - V.smoothstepFloor, 0.001),
			);
			const altGate = 1 - altitudeDetailMix(model.altitude);
			const boost = 1.0 + (w.viirsAlphaBoost - 1.0) * nf;
			const viirsAlpha = Math.min(V.maxAlpha * viirsEase * scale * altGate * boost, 1.0) * bootFade;
			const viirsShow = (show || firstNight) && viirsAlpha > 0.001;
			const viirsBrightness = 5.0 * w.viirsBrightness;

			this.#viirsShow.update(viirsShow, (v) => { this.#viirsLayer!.show = v; });
			this.#viirsAlpha.update(viirsAlpha, (v) => { this.#viirsLayer!.alpha = v; });
			this.#viirsBrightness.update(viirsBrightness, (v) => { this.#viirsLayer!.brightness = v; });
		}

		if (this.#roadMaskLayer) {
			const roadAltGate = 0.3 + 0.7 * altitudeDetailMix(model.altitude);
			const roadAlpha = (nf * scale * roadAltGate + (1 - nf) * 0.08 * roadAltGate) * bootFade;
			const roadBrightness = 1.5 + nf * 1.5;

			this.#roadMaskLayer.show = true;
			this.#roadAlpha.update(roadAlpha, (v) => { this.#roadMaskLayer!.alpha = v; });
			this.#roadBrightness.update(roadBrightness, (v) => { this.#roadMaskLayer!.brightness = v; });
		}
	}
}
