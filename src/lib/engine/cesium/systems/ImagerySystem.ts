import type * as CesiumType from 'cesium';
import { CESIUM } from '$lib/shared/constants';
import { lerp } from '$lib/shared/utils';
import type { CesiumModelView } from '../manager';

const TILE_SERVER_URL =
	(typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TILE_SERVER_URL) || null;

export class ImagerySystem {
	private readonly viewer: CesiumType.Viewer;
	private readonly C: typeof CesiumType;

	nightLayer: CesiumType.ImageryLayer | null = null;
	roadLightLayer: CesiumType.ImageryLayer | null = null;

	private lastNightAlpha = -1;
	private lastNightFactor = -1;
	private lastRoadAlpha = -1;
	private lastNightBrightness = -1;
	private lastNightContrast = -1;
	private lastNightSaturation = -1;
	private lastRoadBrightness = -1;
	private lastRoadContrast = -1;
	private lastRoadSaturation = -1;

	constructor(viewer: CesiumType.Viewer, C: typeof CesiumType) {
		this.viewer = viewer;
		this.C = C;
	}

	async setup(): Promise<void> {
		const useLocal = await this.checkTileServer();
		await this.setupBaseImagery(useLocal);
		this.setupNightLights(useLocal);
		this.setupRoadGlow(useLocal);
	}

	private async checkTileServer(): Promise<boolean> {
		if (!TILE_SERVER_URL) return false;
		try {
			const resp = await fetch(`${TILE_SERVER_URL}/health`, { signal: AbortSignal.timeout(500) });
			return resp.ok;
		} catch { return false; }
	}

	private async setupBaseImagery(useLocal: boolean): Promise<void> {
		if (useLocal) {
			const C = this.C;
			const provider = new C.UrlTemplateImageryProvider({
				url: `${TILE_SERVER_URL}/imagery/{z}/{x}/{y}.jpg`,
				maximumLevel: 17,
				minimumLevel: 0,
			});
			this.viewer.imageryLayers.addImageryProvider(provider);
		} else {
			const C = this.C;
			const provider = new C.UrlTemplateImageryProvider({
				url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
				maximumLevel: 19,
				minimumLevel: 0,
			});
			this.viewer.imageryLayers.addImageryProvider(provider);
		}
	}

	private setupNightLights(useLocal: boolean): void {
		if (useLocal) return;
		const C = this.C;
		try {
			this.nightLayer = this.viewer.imageryLayers.addImageryProvider(
				new C.UrlTemplateImageryProvider({
					url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
					maximumLevel: 18,
					minimumLevel: 0,
				}),
			);
			if (this.nightLayer) {
				this.nightLayer.alpha = 0;
				this.nightLayer.show = false;
			}
		} catch (e) {
			console.warn('[CesiumImagery] Night lights unavailable:', e);
		}
	}

	private setupRoadGlow(useLocal: boolean): void {
		if (useLocal) return;
		const C = this.C;
		try {
			const roadProvider = new C.UrlTemplateImageryProvider({
				url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
				maximumLevel: 18,
				minimumLevel: 0,
			});
			this.roadLightLayer = this.viewer.imageryLayers.addImageryProvider(roadProvider);
			if (this.roadLightLayer) {
				this.roadLightLayer.alpha = 0;
				this.roadLightLayer.show = false;
			}
		} catch (e) {
			console.warn('[CesiumImagery] Road glow unavailable:', e);
		}
	}

	sync(m: CesiumModelView): void {
		if (!this.nightLayer) return;
		const nf = m.nightFactor;
		const scale = m.nightLightScale;

		const nightAlpha = lerp(0, CESIUM.VIIRS_NIGHT_ALPHA, nf) * scale;
		const nightBrightness = lerp(1, CESIUM.VIIRS_NIGHT_BRIGHTNESS, nf) * scale;
		const nightContrast = lerp(1, CESIUM.VIIRS_CONTRAST, nf);
		const nightSaturation = lerp(1, CESIUM.VIIRS_CONTRAST, nf);
		const show = nf > 0.01;

		// Force show=true on first night transition — ensures night layer appears
		// even when nf jumps from 0 to 1 (slider drag). Without this, the dirty
		// check on lastNightFactor might prevent show from updating.
		const firstNight = this.lastNightFactor < 0.01 && nf > 0.01;
		this.lastNightFactor = nf;

		this.nightLayer.show = show || firstNight;
		if (Math.abs(nightAlpha - this.lastNightAlpha) > 0.001) {
			this.lastNightAlpha = nightAlpha;
			this.nightLayer.alpha = nightAlpha;
		}
		if (Math.abs(nightBrightness - this.lastNightBrightness) > 0.001) {
			this.lastNightBrightness = nightBrightness;
			this.nightLayer.brightness = nightBrightness;
		}
		if (Math.abs(nightContrast - this.lastNightContrast) > 0.001) {
			this.lastNightContrast = nightContrast;
			this.nightLayer.contrast = nightContrast;
		}
		if (Math.abs(nightSaturation - this.lastNightSaturation) > 0.001) {
			this.lastNightSaturation = nightSaturation;
			this.nightLayer.saturation = nightSaturation;
		}

		if (this.roadLightLayer) {
			const roadAlpha = lerp(0, CESIUM.ROAD_LIGHT_NIGHT_ALPHA, nf) * scale;
			const roadBrightness = lerp(1, CESIUM.ROAD_LIGHT_NIGHT_BRIGHTNESS, nf) * scale;
			const roadContrast = lerp(1, CESIUM.ROAD_LIGHT_CONTRAST, nf);
			const roadSaturation = lerp(1, CESIUM.ROAD_LIGHT_SATURATION, nf);

			this.roadLightLayer.show = show;
			if (Math.abs(roadAlpha - this.lastRoadAlpha) > 0.001) {
				this.lastRoadAlpha = roadAlpha;
				this.roadLightLayer.alpha = roadAlpha;
			}
			if (Math.abs(roadBrightness - this.lastRoadBrightness) > 0.001) {
				this.lastRoadBrightness = roadBrightness;
				this.roadLightLayer.brightness = roadBrightness;
			}
			if (Math.abs(roadContrast - this.lastRoadContrast) > 0.001) {
				this.lastRoadContrast = roadContrast;
				this.roadLightLayer.contrast = roadContrast;
			}
			if (Math.abs(roadSaturation - this.lastRoadSaturation) > 0.001) {
				this.lastRoadSaturation = roadSaturation;
				this.roadLightLayer.saturation = roadSaturation;
			}
		}
	}
}
