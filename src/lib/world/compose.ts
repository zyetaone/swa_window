/**
 * CesiumManager — consolidated Cesium globe engine.
 *
 * Single file for: Viewer lifecycle, terrain, buildings, imagery,
 * atmosphere sync, post-processing, and the per-frame render loop.
 */

import type * as CesiumType from 'cesium';
import type { LocationId, WeatherType, QualityMode } from '$lib/types';
import { syncWorldQuality, world as v2world } from '$lib/model/config/v2.svelte';
type WorldConfig = typeof v2world;
import { normalizeHeading, shortestAngleDelta, lerp } from '$lib/utils';
import {
	getIonToken,
	checkLocalTileServer,
	TILE_SERVER_URL,
	getSatelliteImagery,
	VIEWER_OPTIONS,
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
	/** Phase 7 — used by compose.ts for camera.effectiveHeading() parallax offset. */
	config: {
		camera: {
			effectiveHeading(baseHeading: number): number;
		};
		world: WorldConfig;
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
	private camAlt: number = 35_000;
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
	// baseLayer: Sentinel-2 / ESRI / Mapbox terrain texture — dimmed + desaturated
	//   as night falls. The vivid day EOX boost is kept via baseDay* caches so
	//   we can lerp between day-vivid and night-dark.
	// nightLayer: CartoDB Dark — composited over base at night. Its dark
	//   background darkens; its lit road grid punches through as warm city
	//   light after the GLSL shader's additive pass.
	private baseLayer: CesiumType.ImageryLayer | null = null;
	private baseDaySaturation = 1.0;
	private baseDayContrast = 1.0;
	private nightLayer: CesiumType.ImageryLayer | null = null;

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
		// Globe lighting ON — terminator (day/night boundary) now renders on
		// the globe, and terrain/buildings cast real shadows when the sun is
		// low. Sun position is driven by syncClock (local-at-longitude UTC).
		v.scene.globe.enableLighting = true;
		if (v.shadowMap) v.shadowMap.enabled = true;
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
	 * Sync Cesium's internal clock to the model's time-of-day, treating
	 * timeOfDay as LOCAL solar time at the current view longitude.
	 *
	 * Cesium computes sun position from absolute UTC, so we have to
	 * back-convert: UTC = localHour - longitude/15 (each 15° east shifts
	 * solar noon one hour earlier in UTC). Without this, "Dubai 4 PM"
	 * (timeOfDay=16) was being passed straight to UTC, putting the sun
	 * over the Pacific and rendering Dubai as deep night with stars.
	 */
	private syncClock(): void {
		const C = this.CesiumModule;
		const localHour = ((this.model.timeOfDay % 24) + 24) % 24;
		const lon = this.model.flight.lon;
		const utcRaw = localHour - lon / 15;
		const utcHour = ((utcRaw % 24) + 24) % 24;
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

		// Bloom: enabled at non-performance quality modes so bright city-light
		// pixels bleed into soft halos that merge between adjacent intersections.
		// contrast=128 + brightness=-0.3 restricts contribution to genuinely
		// bright fragments (no bloom on dim terrain). sigma=3.5 widens Gaussian
		// enough that adjacent road-intersection halos merge into pooled glow.
		// Performance preset disables — Pi 5 GPU headroom is too tight there.
		const bloom = v.scene.postProcessStages?.bloom;
		if (bloom) {
			const allowBloom = this.model.qualityMode !== 'performance';
			bloom.enabled = allowBloom;
			if (allowBloom) {
				const w = this.model.config.world;
				bloom.uniforms.contrast = w.bloomContrast;
				bloom.uniforms.brightness = w.bloomBrightness;
				bloom.uniforms.sigma = w.bloomSigma;
				bloom.uniforms.delta = 1.0;
				bloom.uniforms.stepSize = 1.0;
				(bloom as unknown as { glowOnly?: boolean }).glowOnly = false;
			}
		}

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
		const C = this.CesiumModule;

		// Source decision lives entirely in getSatelliteImagery():
		//   TILE_SERVER_URL set  → local-cached EOX (z3-z12, WebMercator)
		//   MAPBOX_TOKEN set     → Mapbox satellite
		//   default              → remote EOX Sentinel-2
		//   VITE_SENTINEL2=false → ESRI World Imagery
		const cfg = getSatelliteImagery();
		console.info('[CesiumManager] base imagery:', cfg.label);

		const provider = new C.UrlTemplateImageryProvider({
			url: cfg.url,
			maximumLevel: cfg.maxZoom,
			minimumLevel: 0,
			...(cfg.webMercator ? { tilingScheme: new C.WebMercatorTilingScheme() } : {}),
		});
		this.baseLayer = this.viewer.imageryLayers.addImageryProvider(provider);
		// EOX Sentinel-2 cloud-filtered composite is naturally muted at z6-z12.
		// ESRI/Mapbox come pre-saturated. These per-source tweaks restore vivid
		// terrain colors without crushing highlights. baseDay* values are the
		// DAY target — syncImagery lerps toward dark/muted at night.
		if (this.baseLayer) {
			this.baseDaySaturation = cfg.label.startsWith('eox') ? 1.4 : 1.15;
			this.baseDayContrast = cfg.label.startsWith('eox') ? 1.2 : 1.05;
			this.baseLayer.saturation = this.baseDaySaturation;
			this.baseLayer.contrast = this.baseDayContrast;
			this.baseLayer.gamma = cfg.label.startsWith('eox') ? 1.05 : 1.0;
			this.baseLayer.brightness = 1.0;
		}

		// Night layer — CartoDB Dark. Route through local cache when available.
		const tileBase = TILE_SERVER_URL?.replace(/\/$/, '');
		const cartoUrl = tileBase
			? `${tileBase}/cartodb-dark/{z}/{x}/{y}@2x.png`
			: CARTODB_DARK_URL;

		// Single dark overlay — the approach that worked before the dual-layer
		// experiment. The tile background is nearly-black with lit road pixels;
		// composited at alpha ~0.7 it covers the bright day base (darkening the
		// whole scene), while the shader's additive light pass amplifies the
		// lit pixels into warm city glow. No colorToAlpha — we WANT the dark
		// part of the tile to do the darkening.
		try {
			this.nightLayer = this.viewer.imageryLayers.addImageryProvider(
				new C.UrlTemplateImageryProvider({
					url: cartoUrl,
					maximumLevel: 18,
					minimumLevel: 0,
					...(tileBase ? { tilingScheme: new C.WebMercatorTilingScheme() } : {}),
				}),
			);
			if (this.nightLayer) {
				this.nightLayer.alpha = 0;
				this.nightLayer.show = false;
			}
		} catch (e) {
			console.warn('[CesiumManager] Night layer failed:', e);
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

		// Phase 7 — multi-Pi parallax. For solo role (default), parallax
		// offset is 0 and this is a no-op. For left/center/right in a
		// panorama, the per-device yaw shifts the view so three Pis tile
		// into a continuous horizon band from the same shared flight state.
		const parallaxHeading = this.model.config.camera.effectiveHeading(this.camHeading);

		this.viewer.camera.setView({
			destination: this.CesiumModule.Cartesian3.fromDegrees(this.camLon, this.camLat, this.camAlt * 0.3048),
			orientation: {
				heading: this.CesiumModule.Math.toRadians((parallaxHeading + 90) % 360),
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

		// Skybox stays on always — vite-plugin-static-copy serves the SkyBox
		// star textures from /cesiumStatic/Assets/Textures/SkyBox/, so night
		// gets a real starfield. (Earlier workaround disabled it because of
		// a stale-build issue — fixed at the static-asset config layer now.)
		if (v.scene.skyBox) v.scene.skyBox.show = true;

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
		const nf = this.model.nightFactor;
		const scale = this.model.nightLightScale;

		const show = nf > 0.01;
		const firstNight = this.lastNightFactor < 0.01 && nf > 0.01;
		this.lastNightFactor = nf;

		// Base layer: dim + desaturate as night falls so the EOX day vibrance
		// doesn't leak through the CartoDB overlay's alpha gap. Without this
		// step the shader's additive-light pass (lightMask 0.12–0.5) catches
		// faint terrain pixels and amber-boosts them, making night look like
		// an orange haze rather than actual darkness.
		const w = this.model.config.world;
		if (this.baseLayer) {
			this.baseLayer.brightness = lerp(1.0, w.baseNightBrightness, nf);
			this.baseLayer.saturation = lerp(this.baseDaySaturation, w.baseNightSaturation, nf);
		}

		if (!this.nightLayer) return;
		this.nightLayer.show = show || firstNight;
		const alpha = lerp(0, w.nightAlpha, nf) * scale;
		if (Math.abs(alpha - this.lastNightAlpha) > 0.001) {
			this.lastNightAlpha = alpha;
			this.nightLayer.alpha = alpha;
			this.nightLayer.brightness = lerp(1, w.nightBrightness, nf) * scale;
			this.nightLayer.contrast = lerp(1, w.nightContrast, nf);
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
				const w = this.model.config.world;
				this.tileset.maximumScreenSpaceError = w.msse;
				// Cast + receive shadows — buildings drop long shadows across
				// the terrain at low-sun times, grounding them in the scene.
				this.tileset.shadows = this.CesiumModule.ShadowMode.ENABLED;
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
		syncWorldQuality(mode);
		const w = this.model.config.world;
		const globe = this.viewer.scene.globe;
		globe.maximumScreenSpaceError = w.msse;
		globe.tileCacheSize = w.tileCache;
		globe.preloadSiblings = w.preloadSiblings;
		globe.preloadAncestors = w.preloadAncestors;
		globe.loadingDescendantLimit = w.loadingDescendantLimit;
		if (this.tileset) this.tileset.maximumScreenSpaceError = w.msse;
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
