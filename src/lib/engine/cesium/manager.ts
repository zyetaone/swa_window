/**
 * CesiumManager — consolidated Cesium globe engine.
 *
 * Owns the Viewer lifecycle, terrain, imagery, camera, atmosphere,
 * buildings, and post-processing. Sub-systems are inner classes for
 * logical grouping — each focused on one domain.
 *
 * Usage:
 *   const cesium = new CesiumManager(model, Cesium);
 *   await cesium.start(containerElement, COLOR_GRADING_GLSL);
 *   // tick() is auto-registered to postRender — no manual call needed
 *   cesium.destroy();
 */

import { lerp } from '$lib/shared/utils';
import { CESIUM, CESIUM_QUALITY_PRESETS } from '$lib/shared/constants';
import type { QualityMode } from '$lib/shared/constants';
import type { LocationId, WeatherType } from '$lib/shared/types';
import type * as CesiumType from 'cesium';

/** Narrow interface — what CesiumManager reads from the model. Avoids circular import from core/. */
export interface CesiumModelView {
	lat: number;
	lon: number;
	altitude: number;
	heading: number;
	pitch: number;
	bankAngle: number;
	nightFactor: number;
	dawnDuskFactor: number;
	nightLightScale: number;
	haze: number;
	showBuildings: boolean;
	qualityMode: QualityMode;
	location: LocationId;
	weather: WeatherType;
}

const TILE_SERVER_URL =
	(typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TILE_SERVER_URL) || null;

// ─── CesiumTerrain ─────────────────────────────────────────────────────────────

class CesiumTerrain {
	private readonly viewer: CesiumType.Viewer;
	private readonly C: typeof CesiumType;

	constructor(viewer: CesiumType.Viewer, C: typeof CesiumType) {
		this.viewer = viewer;
		this.C = C;
	}

	async setup(): Promise<void> {
		const useLocal = await this.checkTileServer();

		if (useLocal) {
			await this.setupLocal();
		} else if (this.checkIonToken()) {
			await this.setupIon();
		} else {
			await this.setupFreeTerrain();
		}
	}

	private async checkTileServer(): Promise<boolean> {
		if (!TILE_SERVER_URL) return false;
		try {
			const resp = await fetch(`${TILE_SERVER_URL}/health`, { signal: AbortSignal.timeout(500) });
			return resp.ok;
		} catch { return false; }
	}

	private checkIonToken(): boolean {
		const token = (import.meta as any).env?.VITE_CESIUM_ION_TOKEN;
		return !!(token && token !== 'your-cesium-ion-token-here');
	}

	private async setupIon(): Promise<void> {
		const C = this.C;
		try {
			this.viewer.terrainProvider = await C.createWorldTerrainAsync({
				requestVertexNormals: true,
				requestWaterMask: true,
			});
		} catch (e) {
			console.warn('[CesiumTerrain] Ion terrain failed, falling back to free terrain:', e);
			await this.setupFreeTerrain();
		}
	}

	private async setupFreeTerrain(): Promise<void> {
		const C = this.C;
		try {
			this.viewer.terrainProvider = await C.CesiumTerrainProvider.fromUrl(
				'https://s3.us-west-2.amazonaws.com/elevation-tiles-prod/terrarium',
				{ requestVertexNormals: false, requestWaterMask: false },
			);
		} catch (e) {
			console.warn('[CesiumTerrain] Free terrain unavailable, using ellipsoid:', e);
			this.viewer.terrainProvider = new C.EllipsoidTerrainProvider();
		}
	}

	private async setupLocal(): Promise<void> {
		const C = this.C;
		try {
			this.viewer.terrainProvider = await C.CesiumTerrainProvider.fromUrl(
				`${TILE_SERVER_URL}/terrain`,
				{ requestVertexNormals: true, requestWaterMask: true },
			);
		} catch (e) {
			console.warn('[CesiumTerrain] Local terrain failed, falling back to Ion:', e);
			await this.setupIon();
		}
	}

	applyQualityMode(mode: QualityMode): void {
		const globe = this.viewer.scene.globe;
		const p = CESIUM_QUALITY_PRESETS[mode];
		globe.maximumScreenSpaceError = p.maximumScreenSpaceError;
		globe.tileCacheSize = p.tileCacheSize;
		globe.preloadSiblings = p.preloadSiblings;
		globe.preloadAncestors = p.preloadAncestors;
		globe.loadingDescendantLimit = p.loadingDescendantLimit;
	}
}

// ─── CesiumImagery ─────────────────────────────────────────────────────────────

class CesiumImagery {
	private readonly viewer: CesiumType.Viewer;
	private readonly C: typeof CesiumType;

	nightLayer: CesiumType.ImageryLayer | null = null;
	roadLightLayer: CesiumType.ImageryLayer | null = null;

	private lastNightAlpha = -1;
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
			// ESRI World Imagery — free, no auth needed
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
		// CartoDB dark_all serves as the night city glow overlay
		// — shown at night via sync() alpha on top of the dark_nolabels base
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

		this.nightLayer.show = show;
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

// ─── CesiumAtmosphere ───────────────────────────────────────────────────────────

class CesiumAtmosphere {
	private readonly viewer: CesiumType.Viewer;
	private readonly C: typeof CesiumType;
	private readonly model: CesiumModelView;

	private lastGlobeColor = '';
	private lastFogDensity = -1;
	private lastFogBrightness = -1;
	private lastLightIntensity = -1;
	private lastSkySatShift = 999;

	constructor(viewer: CesiumType.Viewer, C: typeof CesiumType, model: CesiumModelView) {
		this.viewer = viewer;
		this.C = C;
		this.model = model;
	}

	sync(): void {
		const v = this.viewer;
		const m = this.model;
		const C = this.C;
		const nf = m.nightFactor;
		const dd = m.dawnDuskFactor;

		// Globe color (day: blue-gray, night: dark navy — keeps terrain visible)
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

		// Fog (day: none, night: moderate haze)
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

// ─── CesiumBuildings ───────────────────────────────────────────────────────────

class CesiumBuildings {
	private readonly viewer: CesiumType.Viewer;
	private readonly C: typeof CesiumType;
	private readonly model: CesiumModelView;

	private tileset: CesiumType.Cesium3DTileset | null = null;
	private lastNightFactor = -1;

	constructor(viewer: CesiumType.Viewer, C: typeof CesiumType, model: CesiumModelView) {
		this.viewer = viewer;
		this.C = C;
		this.model = model;
	}

	async setup(qualityMode: QualityMode = 'balanced'): Promise<void> {
		if (!this.C) return;
		// createOsmBuildingsAsync() requires a valid Ion token. If the token
		// is missing or invalid (401/404), it will fail — no point calling it.
		const hasIonToken = this.checkIonToken();
		if (!hasIonToken) {
			console.warn('[CesiumBuildings] Ion token missing — buildings disabled');
			return;
		}
		try {
			this.tileset = await this.C.createOsmBuildingsAsync();
			this.tileset.show = this.model.showBuildings;
			this.applyQualityMode(qualityMode);
			this.viewer.scene.primitives.add(this.tileset);
			// Don't apply style here — tileset needs to load first. syncNightFactor is
			// called every tick and will apply the style once tileset is ready.
		} catch (err) {
			console.warn('[CesiumBuildings] OSM buildings unavailable:', (err as Error).message ?? err);
		}
	}

	private checkIonToken(): boolean {
		const token = (import.meta as any).env?.VITE_CESIUM_ION_TOKEN;
		return !!(token && token !== 'your-cesium-ion-token-here');
	}

	applyQualityMode(mode: QualityMode): void {
		if (!this.tileset) return;
		const p = CESIUM_QUALITY_PRESETS[mode];
		this.tileset.maximumScreenSpaceError = p.maximumScreenSpaceError;
	}

	sync(): void {
		if (this.tileset) this.tileset.show = this.model.showBuildings;
	}

	syncNightFactor(): void {
		const nf = this.model.nightFactor;
		if (Math.abs(nf - this.lastNightFactor) < 0.01) return;
		this.lastNightFactor = nf;
		this.applyNightStyle(nf);
	}

	private applyNightStyle(nf: number): void {
		const t = this.tileset;
		if (!t) return;

		// Use a flat string expression — simplest valid color expression
		const r = Math.round(lerp(240, 80, nf));
		const g = Math.round(lerp(220, 75, nf));
		const b = Math.round(lerp(200, 60, nf));
		t.style = new this.C.Cesium3DTileStyle({
			color: `rgba(${r}, ${g}, ${b}, 0.9)`,
		});
	}
}

// ─── CesiumPostProcess ───────────────────────────────────────────────────────

class CesiumPostProcess {
	private readonly viewer: CesiumType.Viewer;
	private readonly C: typeof CesiumType;
	private readonly model: CesiumModelView;

	constructor(viewer: CesiumType.Viewer, C: typeof CesiumType, model: CesiumModelView) {
		this.viewer = viewer;
		this.C = C;
		this.model = model;
	}

	setup(COLOR_GRADING_GLSL: string): void {
		const v = this.viewer;
		const m = this.model;

		if (v.scene.postProcessStages?.bloom) {
			v.scene.postProcessStages.bloom.enabled = false;
		}

		try {
			const stage = new this.C.PostProcessStage({
				fragmentShader: COLOR_GRADING_GLSL,
				uniforms: {
					u_nightFactor: () => m.nightFactor,
					u_dawnDuskFactor: () => m.dawnDuskFactor,
					u_lightIntensity: () => m.nightLightScale,
				},
			});
			v.scene.postProcessStages.add(stage);
		} catch (e) {
			console.warn('[CesiumPostProcess] Color grading failed:', e);
		}
	}
}

// ─── CesiumManager ─────────────────────────────────────────────────────────────

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

	// Subsystems
	private terrain!: CesiumTerrain;
	private imagery!: CesiumImagery;
	private atmosphere!: CesiumAtmosphere;
	private buildings!: CesiumBuildings;
	private postProcess!: CesiumPostProcess;

	constructor(model: CesiumModelView, CesiumModule: typeof CesiumType) {
		this.model = model;
		this.CesiumModule = CesiumModule;
		this.viewer = new CesiumModule.Viewer(this.viewerContainer(), this.viewerOptions());
	}

	private viewerContainer(): HTMLElement {
		const el = document.createElement('div');
		el.style.display = 'none';
		document.body.appendChild(el);
		return el;
	}

	private viewerOptions(): Record<string, unknown> {
		return {
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
		};
	}

	private initSubSystems(): void {
		const v = this.viewer;
		const C = this.CesiumModule;
		const m = this.model;

		this.terrain = new CesiumTerrain(v, C);
		this.imagery = new CesiumImagery(v, C);
		this.atmosphere = new CesiumAtmosphere(v, C, m);
		this.buildings = new CesiumBuildings(v, C, m);
		this.postProcess = new CesiumPostProcess(v, C, m);
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

		this.initSubSystems();

		// Register tick to postRender (fires once per Cesium frame, after rendering)
		v.scene.postRender.addEventListener(this.tick.bind(this));

		this.postProcess.setup(COLOR_GRADING_GLSL);
		await this.terrain.setup();
		await this.imagery.setup();
		await this.buildings.setup(this.model.qualityMode);
	}

	private tick(): void {
		const now = performance.now();
		const dt = Math.min((now - this.lastPostRenderTime) / 1000, 0.1);
		this.lastPostRenderTime = now;

		// Time-based camera lerp
		const t = this.model;
		if (!this.camInitialized) {
			this.camLat = t.lat;
			this.camLon = t.lon;
			this.camAlt = t.altitude;
			this.camHeading = t.heading;
			this.camPitch = t.pitch;
			this.camBank = t.bankAngle;
			this.camInitialized = true;
		}

		const k = Math.min(1 - Math.exp(-dt / this.LERP_T), this.MAX_K);

		this.camLat += (t.lat - this.camLat) * k;
		this.camLon += (t.lon - this.camLon) * k;
		this.camAlt += (t.altitude - this.camAlt) * k;

		let dH = t.heading - this.camHeading;
		if (dH > 180) dH -= 360;
		if (dH < -180) dH += 360;
		this.camHeading += dH * k;
		this.camHeading = ((this.camHeading % 360) + 360) % 360;

		this.camPitch += (t.pitch - this.camPitch) * k;
		this.camBank += (t.bankAngle - this.camBank) * k;

		this.viewer.camera.setView({
			destination: this.CesiumModule.Cartesian3.fromDegrees(
				this.camLon, this.camLat, this.camAlt * 0.3048,
			),
			orientation: {
				heading: this.CesiumModule.Math.toRadians((this.camHeading + 90) % 360),
				pitch: this.CesiumModule.Math.toRadians(this.camPitch - 90),
				roll: this.CesiumModule.Math.toRadians(-this.camBank),
			},
		});

		// Subsystem sync
		this.imagery.sync(t);
		this.atmosphere.sync();
		this.buildings.sync();
		this.buildings.syncNightFactor();
	}

	applyQualityMode(mode: QualityMode): void {
		this.terrain.applyQualityMode(mode);
		this.buildings.applyQualityMode(mode);
	}

	destroy(): void {
		this.abortController.abort();
		if (!this.viewer.isDestroyed()) {
			this.viewer.destroy();
		}
	}
}
