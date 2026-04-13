/**
 * CesiumManager — consolidated Cesium globe engine.
 *
 * Single file for: Viewer lifecycle, terrain, buildings, imagery,
 * atmosphere sync, post-processing, and the per-frame render loop.
 */

import { CESIUM, CESIUM_QUALITY_PRESETS, type QualityMode } from '$lib/shared/constants';
import type { LocationId, WeatherType } from '$lib/shared/types';
import { normalizeHeading, lerp } from '$lib/shared/utils';
import type * as CesiumType from 'cesium';
import { getIonToken, checkLocalTileServer, TILE_SERVER_URL } from './config';

export interface CesiumModelView {
	flight: {
		lat: number;
		lon: number;
		altitude: number;
		heading: number;
		pitch: number;
	};
	motion: {
		bankAngle: number;
	};
	timeOfDay: number;
	nightFactor: number;
	dawnDuskFactor: number;
	nightLightScale: number;
	haze: number;
	showBuildings: boolean;
	qualityMode: QualityMode;
	location: LocationId;
	weather: WeatherType;
}

export class CesiumManager {
	private readonly CesiumModule: typeof CesiumType;
	private readonly model: CesiumModelView;
	private readonly viewer: CesiumType.Viewer;
	private readonly abortController = new AbortController();

	// Camera lerp state
	private camLat = 0;
	private camLon = 0;
	private camAlt = 35000;
	private camHeading = 45;
	private camPitch = 75;
	private camBank = 0;
	private camInitialized = false;
	private lastPostRenderTime = performance.now();
	private readonly LERP_T = 0.12;
	private readonly MAX_K = 0.3;

	// Asset state
	private tileset: CesiumType.Cesium3DTileset | null = null;
	private lastNightFactor = -1;
	// Imagery Layers
	private nightLayer: CesiumType.ImageryLayer | null = null;
	private roadLightLayer: CesiumType.ImageryLayer | null = null;

	// Effect sync caches
	private lastGlobeColor = '';
	private lastFogDensity = -1;
	private lastFogBrightness = -1;
	private lastLightIntensity = -1;
	private lastSkySatShift = 999;
	private lastTimeOfDay = -1;
	private lastNightAlpha = -1;
	private lastRoadAlpha = -1;
	private lastBuildingNightFactor = -1;

	#viewerContainerEl: HTMLElement | null = null;

	constructor(model: CesiumModelView, CesiumModule: typeof CesiumType) {
		this.CesiumModule = CesiumModule;
		this.model = model;
		this.viewer = new CesiumModule.Viewer(this.viewerContainer(), {
			baseLayer: false as const,
			animation: false,
			baseLayerPicker: false,
			fullscreenButton: false,
			vrButton: false,
			geocoder: false,
			homeButton: false,
			infoBox: false,
			sceneModePicker: false,
			selectionIndicator: false,
			timeline: false,
			navigationHelpButton: false,
			navigationInstructionsInitiallyVisible: false,
			shadows: false,
			useBrowserRecommendedResolution: false,
			contextOptions: {
				webgl: { alpha: false, antialias: true, preserveDrawingBuffer: true },
			},
		});
	}

	viewerContainer(): HTMLElement {
		this.#viewerContainerEl = document.createElement('div');
		this.#viewerContainerEl.style.display = 'none';
		document.body.appendChild(this.#viewerContainerEl);
		return this.#viewerContainerEl;
	}

	async start(container: HTMLElement, COLOR_GRADING_GLSL: string): Promise<void> {
		const C = this.CesiumModule;
		const v = this.viewer;

		const widgetEl = (v as any).cesiumWidget?.container;
		if (widgetEl?.parentElement !== container) {
			container.appendChild(widgetEl);
		}

		v.scene.logarithmicDepthBuffer = true;
		v.scene.highDynamicRange = true;
		v.scene.postProcessStages.fxaa.enabled = true;
		v.scene.globe.enableLighting = false;
		v.scene.globe.oceanNormalMapUrl = C.buildModuleUrl('Assets/Textures/waterNormals.jpg');

		if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true;
		if (v.scene.skyBox) v.scene.skyBox.show = true;
		if (v.scene.sun) { v.scene.sun.show = true; v.scene.sun.glowFactor = 2.0; }
		if (v.scene.moon) v.scene.moon.show = true;

		v.scene.postRender.addEventListener(this.tick.bind(this));

		this.setupPostProcess(COLOR_GRADING_GLSL);
		await this.setupTerrain();
		await this.setupImagery();
		await this.setupBuildings();
	}

	// ─── Post Process Setup ──────────────────────────────────────────────────
	private setupPostProcess(glsl: string): void {
		const v = this.viewer;
		if (v.scene.postProcessStages?.bloom) v.scene.postProcessStages.bloom.enabled = false;
		try {
			const stage = new this.CesiumModule.PostProcessStage({
				fragmentShader: glsl,
				uniforms: {
					u_nightFactor: () => this.model.nightFactor,
					u_dawnDuskFactor: () => this.model.dawnDuskFactor,
					u_lightIntensity: () => this.model.nightLightScale,
				},
			});
			v.scene.postProcessStages.add(stage);
		} catch (e) {
			console.warn('[CesiumManager] Post-process failed:', e);
		}
	}

	// ─── Imagery Setup ───────────────────────────────────────────────────────
	private async setupImagery(): Promise<void> {
		let useLocal = false;
		if (TILE_SERVER_URL) {
			try {
				const resp = await fetch(`${TILE_SERVER_URL}/health`, { signal: AbortSignal.timeout(500) });
				useLocal = resp.ok;
			} catch {}
		}

		const C = this.CesiumModule;
		const provider = new C.UrlTemplateImageryProvider({
			url: useLocal ? `${TILE_SERVER_URL}/imagery/{z}/{x}/{y}.jpg` : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
			maximumLevel: useLocal ? 17 : 19,
			minimumLevel: 0,
		});
		this.viewer.imageryLayers.addImageryProvider(provider);

		if (!useLocal) {
			try {
				this.nightLayer = this.viewer.imageryLayers.addImageryProvider(
					new C.UrlTemplateImageryProvider({ url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png', maximumLevel: 18, minimumLevel: 0 })
				);
				if (this.nightLayer) { this.nightLayer.alpha = 0; this.nightLayer.show = false; }
				
				this.roadLightLayer = this.viewer.imageryLayers.addImageryProvider(
					new C.UrlTemplateImageryProvider({ url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png', maximumLevel: 18, minimumLevel: 0 })
				);
				if (this.roadLightLayer) { this.roadLightLayer.alpha = 0; this.roadLightLayer.show = false; }
			} catch (e) {
				console.warn('[CesiumManager] Night layers failed:', e);
			}
		}
	}

	// ─── Render Loop ──────────────────────────────────────────────────────────
	private tick(): void {
		const now = performance.now();
		const dt = Math.min((now - this.lastPostRenderTime) / 1000, 0.1);
		this.lastPostRenderTime = now;

		this.syncCamera(dt);
		this.syncAtmosphere();
		this.syncImagery();
		this.syncBuildings();
	}

	private syncCamera(dt: number): void {
		const f = this.model.flight;
		const mot = this.model.motion;

		if (!this.camInitialized) {
			this.camLat = f.lat; this.camLon = f.lon; this.camAlt = f.altitude;
			this.camHeading = f.heading; this.camPitch = f.pitch; this.camBank = mot.bankAngle;
			this.camInitialized = true;
		}

		const k = Math.min(1 - Math.exp(-dt / this.LERP_T), this.MAX_K);

		this.camLat += (f.lat - this.camLat) * k;
		this.camLon += (f.lon - this.camLon) * k;
		this.camAlt += (f.altitude - this.camAlt) * k;

		let dH = f.heading - this.camHeading;
		if (dH > 180) dH -= 360;
		if (dH < -180) dH += 360;
		this.camHeading = normalizeHeading(this.camHeading + dH * k);
		this.camPitch += (f.pitch - this.camPitch) * k;
		this.camBank += (mot.bankAngle - this.camBank) * k;

		this.viewer.camera.setView({
			destination: this.CesiumModule.Cartesian3.fromDegrees(this.camLon, this.camLat, this.camAlt * 0.3048),
			orientation: {
				heading: this.CesiumModule.Math.toRadians((this.camHeading + 90) % 360),
				pitch: this.CesiumModule.Math.toRadians(this.camPitch - 90),
				roll: this.CesiumModule.Math.toRadians(-this.camBank),
			},
		});
	}

	private syncAtmosphere(): void {
		const m = this.model;
		const v = this.viewer;
		const C = this.CesiumModule;
		const nf = m.nightFactor;
		const dd = m.dawnDuskFactor;

		const isSunVisible = m.timeOfDay > 6 && m.timeOfDay < 20;
		if (this.lastTimeOfDay !== m.timeOfDay) {
			this.lastTimeOfDay = m.timeOfDay;
			if (v.scene.sun) v.scene.sun.show = isSunVisible;
		}

		let r = lerp(140, 25, nf); let g = lerp(170, 25, nf); let b = lerp(200, 40, nf);
		r = lerp(r, 100, dd * 0.3); g = lerp(g, 80, dd * 0.3); b = lerp(b, 70, dd * 0.3);
		const colorKey = `${r},${g},${b}`;
		if (colorKey !== this.lastGlobeColor) {
			this.lastGlobeColor = colorKey;
			v.scene.globe.baseColor = C.Color.fromBytes(Math.round(r), Math.round(g), Math.round(b), 255);
		}

		const satShift = lerp(0, -0.8, nf) + dd * 0.2;
		if (Math.abs(satShift - this.lastSkySatShift) > 0.01) {
			this.lastSkySatShift = satShift;
			if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.saturationShift = satShift;
		}

		const targetDensity = lerp(0.0, 0.00008, nf) * (1 + m.haze * 8);
		const targetBrightness = lerp(1.0, 0.1, nf);
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

		const targetIntensity = lerp(1.0, 0.02, nf);
		if (Math.abs(targetIntensity - this.lastLightIntensity) > 0.01) {
			this.lastLightIntensity = targetIntensity;
			if (v.scene.light) v.scene.light.intensity = targetIntensity;
		}
	}

	private syncImagery(): void {
		if (!this.nightLayer) return;
		const nf = this.model.nightFactor;
		const scale = this.model.nightLightScale;

		const show = nf > 0.01;
		const firstNight = this.lastNightFactor < 0.01 && nf > 0.01;
		this.lastNightFactor = nf;

		this.nightLayer.show = show || firstNight;
		const nightAlpha = lerp(0, CESIUM.VIIRS_NIGHT_ALPHA, nf) * scale;
		if (Math.abs(nightAlpha - this.lastNightAlpha) > 0.001) {
			this.lastNightAlpha = nightAlpha;
			this.nightLayer.alpha = nightAlpha;
			this.nightLayer.brightness = lerp(1, CESIUM.VIIRS_NIGHT_BRIGHTNESS, nf) * scale;
			this.nightLayer.contrast = lerp(1, CESIUM.VIIRS_CONTRAST, nf);
		}

		if (this.roadLightLayer) {
			this.roadLightLayer.show = show;
			const roadAlpha = lerp(0, CESIUM.ROAD_LIGHT_NIGHT_ALPHA, nf) * scale;
			if (Math.abs(roadAlpha - this.lastRoadAlpha) > 0.001) {
				this.lastRoadAlpha = roadAlpha;
				this.roadLightLayer.alpha = roadAlpha;
				this.roadLightLayer.brightness = lerp(1, CESIUM.ROAD_LIGHT_NIGHT_BRIGHTNESS, nf) * scale;
				this.roadLightLayer.contrast = lerp(1, CESIUM.ROAD_LIGHT_CONTRAST, nf);
			}
		}
	}

	// ─── Terrain Setup ────────────────────────────────────────────────────────
	private async setupTerrain(): Promise<void> {
		const C = this.CesiumModule;
		const v = this.viewer;
		const useLocal = await checkLocalTileServer();
		if (useLocal) {
			try {
				v.terrainProvider = await C.CesiumTerrainProvider.fromUrl(`${TILE_SERVER_URL}/terrain`, { requestVertexNormals: true, requestWaterMask: true });
				return;
			} catch (e) { console.warn('[CesiumTerrain] Local failed, trying Ion:', e); }
		}
		if (getIonToken()) {
			try {
				v.terrainProvider = await C.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true });
				return;
			} catch (e) { console.warn('[CesiumTerrain] Ion failed, using free terrain:', e); }
		}
		try {
			v.terrainProvider = await C.CesiumTerrainProvider.fromUrl('https://s3.us-west-2.amazonaws.com/elevation-tiles-prod/terrarium', { requestVertexNormals: false, requestWaterMask: false });
		} catch (e) {
			console.warn('[CesiumTerrain] Free terrain unavailable, using ellipsoid:', e);
			v.terrainProvider = new C.EllipsoidTerrainProvider();
		}
	}

	// ─── Building Setup & Sync ────────────────────────────────────────────────
	private async setupBuildings(): Promise<void> {
		if (!getIonToken()) { console.warn('[CesiumBuildings] Ion token missing — buildings disabled'); return; }
		try {
			this.tileset = await this.CesiumModule.createOsmBuildingsAsync();
			if (this.tileset) {
				this.tileset.show = this.model.showBuildings;
				const p = CESIUM_QUALITY_PRESETS[this.model.qualityMode];
				this.tileset.maximumScreenSpaceError = p.maximumScreenSpaceError;
				this.viewer.scene.primitives.add(this.tileset);
			}
		} catch (e) { console.warn('[CesiumBuildings] OSM buildings unavailable:', (e as Error).message); }
	}

	private syncBuildings(): void {
		if (!this.tileset) return;
		this.tileset.show = this.model.showBuildings;
		const nf = this.model.nightFactor;
		if (Math.abs(nf - this.lastBuildingNightFactor) < 0.01) return;
		this.lastBuildingNightFactor = nf;
		const r = Math.round(lerp(240, 80, nf));
		const g = Math.round(lerp(220, 75, nf));
		const b = Math.round(lerp(200, 60, nf));
		this.tileset.style = new this.CesiumModule.Cesium3DTileStyle({ color: `rgba(${r}, ${g}, ${b}, 0.9)` });
	}

	applyQualityMode(mode: QualityMode): void {
		// Terrain
		const globe = this.viewer.scene.globe;
		const p = CESIUM_QUALITY_PRESETS[mode];
		globe.maximumScreenSpaceError = p.maximumScreenSpaceError;
		globe.tileCacheSize = p.tileCacheSize;
		globe.preloadSiblings = p.preloadSiblings;
		globe.preloadAncestors = p.preloadAncestors;
		globe.loadingDescendantLimit = p.loadingDescendantLimit;
		// Buildings
		if (this.tileset) this.tileset.maximumScreenSpaceError = p.maximumScreenSpaceError;
	}

	destroy(): void {
		this.abortController.abort();
		if (!this.viewer.isDestroyed()) {
			this.viewer.destroy();
		}
	}
}
