/**
 * CesiumManager — consolidated Cesium globe engine.
 *
 * Single file for: Viewer lifecycle, terrain, buildings, imagery,
 * atmosphere sync, post-processing, and the per-frame render loop.
 */

import { AIRCRAFT, CESIUM, CESIUM_QUALITY_PRESETS } from '$lib/constants';
import type { LocationId, WeatherType, QualityMode } from '$lib/types';
import { normalizeHeading, shortestAngleDelta, lerp } from '$lib/utils';
import type * as CesiumType from 'cesium';
import {
	getIonToken,
	checkLocalTileServer,
	TILE_SERVER_URL,
	getSatelliteImagery,
	VIEWER_OPTIONS,
	VIIRS_NIGHT_LIGHTS_URL,
	CARTODB_DARK_URL,
} from './config';

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
	sceneFog: { dayDensity: number; nightDensity: number; dayBrightness: number; nightBrightness: number };
	terrainExaggeration: number;
}

export class CesiumManager {
	private readonly CesiumModule: typeof CesiumType;
	private readonly model: CesiumModelView;
	private readonly viewer: CesiumType.Viewer;

	// Camera lerp state
	private camLat = 0;
	private camLon = 0;
	private camAlt: number = AIRCRAFT.DEFAULT_ALTITUDE;
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
	// Imagery Layers — dual-layer night rendering
	// nightLayer: NASA VIIRS City Lights (photographic warm glow)
	// roadLightLayer: CartoDB Dark (vector road + building edge detail)
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
	private lastBuildingNightFactor = -1;
	private lastTerrainExaggeration = -1;

	#boundTick: (() => void) | null = null;

	/**
	 * Construct the Cesium.Viewer directly into the visible `container`.
	 *
	 * Earlier versions used a hidden display:none div, then reparented the
	 * widget into the visible container in start(). That left Cesium's first
	 * frame measuring a 0×0 viewport and locking the camera at "space view"
	 * until a user interaction triggered a re-evaluation. Constructing into
	 * the live container side-steps that entirely.
	 */
	constructor(model: CesiumModelView, CesiumModule: typeof CesiumType, container: HTMLElement) {
		this.CesiumModule = CesiumModule;
		this.model = model;
		this.viewer = new CesiumModule.Viewer(container, VIEWER_OPTIONS);
	}

	/** Live Cesium.Viewer — exposed so scene effects can attach primitives/data sources. */
	getViewer(): CesiumType.Viewer { return this.viewer; }

	/** Bound Cesium module — exposed so scene effects can construct Cesium types. */
	getCesium(): typeof CesiumType { return this.CesiumModule; }

	async start(COLOR_GRADING_GLSL: string): Promise<void> {
		const C = this.CesiumModule;
		const v = this.viewer;

		v.scene.logarithmicDepthBuffer = true;
		v.scene.highDynamicRange = true;
		v.scene.postProcessStages.fxaa.enabled = true;
		v.scene.globe.enableLighting = false;
		// Continuous render — our model state changes every RAF tick, and tick()
		// is hooked to postRender. Without this, Cesium would only re-render
		// when its OWN scene reports a change, missing model-driven updates and
		// trapping the camera at its initial state.
		v.scene.requestRenderMode = false;
		v.scene.globe.oceanNormalMapUrl = C.buildModuleUrl('Assets/Textures/waterNormals.jpg');

		if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true;
		if (v.scene.skyBox) v.scene.skyBox.show = true;
		if (v.scene.sun) { v.scene.sun.show = true; v.scene.sun.glowFactor = 2.0; }
		if (v.scene.moon) v.scene.moon.show = true;

		this.#boundTick = this.tick.bind(this);
		v.scene.postRender.addEventListener(this.#boundTick);

		this.setupPostProcess(COLOR_GRADING_GLSL);
		await this.setupTerrain();
		await this.setupImagery();
		await this.setupBuildings();

		// Set Cesium clock to model time on first frame so sun position is
		// right from the start (otherwise we render with wall-clock UTC
		// briefly until the next timeOfDay change).
		this.syncClock();

		// Force resize + render — Cesium widget was attached to the visible
		// container during start(), but its canvas may still report 0×0 from
		// the hidden parent. Without an explicit resize+render, the first frame
		// can lock the camera at 'space view' and tile requests for the model
		// position never fire. This kick wakes Cesium up.
		v.resize();
		v.scene.requestRender();
	}

	/**
	 * Sync Cesium's internal clock to model.timeOfDay so the sun position
	 * Cesium computes for sky atmosphere matches what the model thinks the
	 * time is. Without this, Cesium uses wall-clock UTC — which produces
	 * day/night mismatches: model says "Dubai 4 PM (day)" while Cesium
	 * renders "Dubai dusk" because the user's wall-clock UTC moment puts
	 * Dubai's longitude past sunset. Production version of this app had
	 * the same method.
	 */
	private syncClock(): void {
		const C = this.CesiumModule;
		const utcHour = ((this.model.timeOfDay % 24) + 24) % 24;
		const hours = Math.floor(utcHour);
		const minutes = Math.floor((utcHour % 1) * 60);
		const now = new Date();
		this.viewer.clock.currentTime = C.JulianDate.fromDate(
			new Date(Date.UTC(
				now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
				hours, minutes,
			)),
		);
	}


	// ─── Post Process Setup ──────────────────────────────────────────────────
	private setupPostProcess(glsl: string): void {
		const v = this.viewer;
		if (v.scene.postProcessStages?.bloom) v.scene.postProcessStages.bloom.enabled = false;
		try {
			const existing = (v.scene.postProcessStages as any).find?.((s: any) => s.name === 'aero-color-grade');
			if (existing) { existing.enabled = true; return; }
			const stage = new this.CesiumModule.PostProcessStage({
				name: 'aero-color-grade',
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
		const useLocal = await checkLocalTileServer();
		const C = this.CesiumModule;

		const cfg = useLocal
			? { url: `${TILE_SERVER_URL}/imagery/{z}/{x}/{y}.jpg`, maxZoom: 17, webMercator: false, label: 'local' }
			: getSatelliteImagery();

		console.info('[CesiumManager] base imagery:', cfg.label);

		const provider = new C.UrlTemplateImageryProvider({
			url: cfg.url,
			maximumLevel: cfg.maxZoom,
			minimumLevel: 0,
			...(cfg.webMercator ? { tilingScheme: new C.WebMercatorTilingScheme() } : {}),
		});
		const baseLayer = this.viewer.imageryLayers.addImageryProvider(provider);
		// EOX Sentinel-2 cloud-filtered composite is naturally muted at z6-z12.
		// ESRI/Mapbox come pre-saturated. These per-source tweaks restore vivid
		// terrain colors without crushing highlights.
		if (baseLayer) {
			baseLayer.saturation = cfg.label.startsWith('eox') ? 1.4 : 1.15;
			baseLayer.contrast = cfg.label.startsWith('eox') ? 1.2 : 1.05;
			baseLayer.gamma = cfg.label.startsWith('eox') ? 1.05 : 1.0;
			baseLayer.brightness = 1.0;
		}

		if (useLocal) return;

		// Layer 1: NASA VIIRS City Lights — satellite-photo warm glow over urban areas.
		// colorToAlpha: BLACK makes the dark space-around-cities transparent, so only
		// the actual lit-up urban pixels composite on top of the base imagery.
		// Without this, the layer would just darken the whole globe at night.
		try {
			this.nightLayer = this.viewer.imageryLayers.addImageryProvider(
				new C.UrlTemplateImageryProvider({ url: VIIRS_NIGHT_LIGHTS_URL, maximumLevel: 8, minimumLevel: 0 }),
			);
			if (this.nightLayer) {
				this.nightLayer.alpha = 0;
				this.nightLayer.show = false;
				this.nightLayer.colorToAlpha = C.Color.BLACK;
				this.nightLayer.colorToAlphaThreshold = 0.18;
			}
		} catch (e) {
			console.warn('[CesiumManager] VIIRS night layer failed:', e);
		}

		// Layer 2: CartoDB Dark — vector road + building outlines for crisp edge detail.
		// Same trick: dark base goes transparent, only the lit road grid bleeds through.
		try {
			this.roadLightLayer = this.viewer.imageryLayers.addImageryProvider(
				new C.UrlTemplateImageryProvider({ url: CARTODB_DARK_URL, maximumLevel: 18, minimumLevel: 0 }),
			);
			if (this.roadLightLayer) {
				this.roadLightLayer.alpha = 0;
				this.roadLightLayer.show = false;
				this.roadLightLayer.colorToAlpha = C.Color.BLACK;
				this.roadLightLayer.colorToAlphaThreshold = 0.20;
			}
		} catch (e) {
			console.warn('[CesiumManager] Road light layer failed:', e);
		}
	}

	// ─── Render Loop ──────────────────────────────────────────────────────────
	private tick(): void {
		const now = performance.now();
		const dt = Math.min((now - this.lastPostRenderTime) / 1000, 0.1);
		this.lastPostRenderTime = now;

		this.syncCamera(dt);
		this.syncAtmosphere();
		this.syncTerrainExaggeration();
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

		this.camHeading = normalizeHeading(this.camHeading + shortestAngleDelta(this.camHeading, f.heading) * k);
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
			this.syncClock();
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

		const fog = m.sceneFog;
		const targetDensity = lerp(fog.dayDensity, fog.nightDensity, nf) * (1 + m.haze * 8);
		const targetBrightness = lerp(fog.dayBrightness, fog.nightBrightness, nf);
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

	private syncTerrainExaggeration(): void {
		const te = this.model.terrainExaggeration;
		if (Math.abs(te - this.lastTerrainExaggeration) > 0.01) {
			this.lastTerrainExaggeration = te;
			this.viewer.scene.verticalExaggeration = te;
		}
	}

	private syncImagery(): void {
		if (!this.nightLayer && !this.roadLightLayer) return;
		const nf = this.model.nightFactor;
		const scale = this.model.nightLightScale;

		const show = nf > 0.01;
		const firstNight = this.lastNightFactor < 0.01 && nf > 0.01;
		this.lastNightFactor = nf;

		// VIIRS: photographic city glow — alpha+brightness ramp with night factor
		if (this.nightLayer) {
			this.nightLayer.show = show || firstNight;
			const alpha = nf * CESIUM.VIIRS_NIGHT_ALPHA * scale;
			if (Math.abs(alpha - this.lastNightAlpha) > 0.001) {
				this.lastNightAlpha = alpha;
				this.nightLayer.alpha = alpha;
				this.nightLayer.brightness = lerp(1, CESIUM.VIIRS_NIGHT_BRIGHTNESS, nf) * scale;
				this.nightLayer.contrast = CESIUM.VIIRS_CONTRAST;
				this.nightLayer.saturation = 0.0;
			}
		}

		// CartoDB Dark: road/building outlines — independent tuning
		if (this.roadLightLayer) {
			this.roadLightLayer.show = show || firstNight;
			this.roadLightLayer.alpha = nf * CESIUM.ROAD_LIGHT_NIGHT_ALPHA * scale;
			this.roadLightLayer.brightness = lerp(1, CESIUM.ROAD_LIGHT_NIGHT_BRIGHTNESS, nf) * scale;
			this.roadLightLayer.contrast = CESIUM.ROAD_LIGHT_CONTRAST;
			this.roadLightLayer.saturation = CESIUM.ROAD_LIGHT_SATURATION;
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
		if (!this.viewer.isDestroyed()) {
			if (this.#boundTick) {
				this.viewer.scene.postRender.removeEventListener(this.#boundTick);
			}
			this.viewer.destroy();
		}
	}
}
