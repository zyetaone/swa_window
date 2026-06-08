/**
 * CesiumManager — consolidated Cesium globe engine.
 *
 * Single file for: Viewer lifecycle, terrain, buildings, imagery,
 * atmosphere sync, post-processing, and the per-frame render loop.
 */

import type * as CesiumType from 'cesium';
import type { LocationId, WeatherType, QualityMode } from '$lib/types';
import { world } from '$lib/model/config-tree.svelte';
import { lerp, smoothstep, clamp, T } from '$lib/utils';
import { NIGHT_PALETTE } from '$content/compositions/night';
import { LightningStage } from './lightning-stage';
import { CloudBillboardLayer } from './cloud-billboard-layer';
import { BUILDING_SHADER_GLSL, BUILDING_VERTEX_GLSL } from './building-shader';
import {
	getIonToken,
	checkLocalTileServer,
	TILE_SERVER_URL,
	getSatelliteImagery,
	VIEWER_OPTIONS,
} from './cesium-setup';

type WorldConfig = typeof world;

// Cesium tile subdivision + preload tuning per quality mode. Sole consumer
// is this file — lives next to the CesiumManager that actually applies it.
interface CesiumQualityPreset {
	maximumScreenSpaceError: number;
	tileCacheSize: number;
	preloadSiblings: boolean;
	preloadAncestors: boolean;
	loadingDescendantLimit: number;
}

const CESIUM_QUALITY_PRESETS: Record<QualityMode, CesiumQualityPreset> = {
	performance: {
		maximumScreenSpaceError: 8,    // Bigger tiles, fewer LOD changes (low-end Pi)
		tileCacheSize: 50,
		preloadSiblings: false,
		preloadAncestors: true,
		loadingDescendantLimit: 4,
	},
	balanced: {
		// MSSE 4 produced visible LOD seams at perspective angles. 5 keeps
		// detail high while reducing per-tile LOD divergence.
		maximumScreenSpaceError: 5,
		tileCacheSize: 100,
		preloadSiblings: true,         // eliminates LOD-boundary lines on camera move
		preloadAncestors: true,
		loadingDescendantLimit: 6,
	},
	ultra: {
		maximumScreenSpaceError: 2,    // High detail — sharper edges
		tileCacheSize: 200,
		preloadSiblings: true,
		preloadAncestors: true,
		loadingDescendantLimit: 8,
	},
};

interface CesiumModelView {
	flight: {
		lat: number;
		lon: number;
		altitude: number;
		heading: number;
		pitch: number;
		camLat: number;
		camLon: number;
		camAlt: number;
		camHeading: number;
		camPitch: number;
	};
	motion: {
		bankAngle: number;
	};
	/** Phase 7 — used by compose.ts for camera.effectiveHeading() parallax offset. */
	config: {
		camera: {
			effectiveHeading(baseHeading: number): number;
			motion: { bankPitchCouple: number };
		};
		world: WorldConfig;
		atmosphere: {
			haze: { amount: number };
			clouds: { density: number; speed: number; layerCount: number };
			weather: {
				hasLightning: boolean;
				lightningDecayRate: number;
				lightningMinInterval: number;
				lightningMaxInterval: number;
			};
		};
	};
	timeOfDay: number;
	nightFactor: number;
	dawnDuskFactor: number;
	nightLightScale: number;
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

	// Camera lerp state (REMOVED — now SSOT in model.flight.cam*)
	private lastPostRenderTime = performance.now();

	// Asset state
	private tileset: CesiumType.Cesium3DTileset | null = null;
	// Procedural building shader — restored Feb-15 recipe. Per-fragment
	// lit windows via model-space grid math. Owns 4 uniforms that we
	// update from syncBuildings(). null if Ion token missing.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private buildingsShader: any = null;
	private buildingsTime = 0;

	// Boot-time fade — defeats the "amber lights glowing against a still-
	// loading globe" flash on initial render. timeOfDay is initialised at
	// noon ($state default), then updateTimeFromSystem() snaps it to the
	// real wall-clock (often deep night) before the first frame. That makes
	// nightFactor jump straight to 1.0 — VIIRS + road mask + procedural
	// building emissive snap to full alpha while Sentinel-2 base tiles are
	// still streaming. Result: amber dots floating against a black sphere
	// for ~1–2s. This fade ramps 0→1 over the first 1.6s after the first
	// syncImagery call, multiplied into every night-gated alpha below.
	private bootStartMs: number | null = null;
	private static readonly BOOT_FADE_MS = 1600;
	private getBootFade(): number {
		if (this.bootStartMs === null) this.bootStartMs = performance.now();
		const t = (performance.now() - this.bootStartMs) / CesiumManager.BOOT_FADE_MS;
		return t >= 1 ? 1 : t < 0 ? 0 : t;
	}
	private lastBuildingAltBlend = -1;
	private lastNightFactor = -1;
	// Imagery Layers
	// baseLayer: Sentinel-2 / ESRI / Mapbox terrain texture — dimmed + desaturated
	//   as night falls. The vivid day EOX boost is kept via baseDay* caches so
	//   we can lerp between day-vivid and night-dark.
	// viirsLayer: NASA VIIRS Black Marble night lights — real satellite
	//   nightlight imagery (z3-z8, 500m/px). ColorToAlpha hides dark (unlit)
	//   pixels; hue+saturation tint toward sodium amber. Only visible at
	//   night via alpha gated on nightFactor.
	// roadMaskLayer: CartoDB Dark with colorToAlpha(BLACK) — white road
	//   geometry survives, everything else punches transparent. Restored
	//   Phase 17 from Feb-15's recipe (the simpler thing that worked) after
	//   the Overpass-fetching RoadLayer was deleted as over-engineered.
	private baseLayer: CesiumType.ImageryLayer | null = null;
	private baseDaySaturation = 1.0;
	private baseDayContrast = 1.0;
	private viirsLayer: CesiumType.ImageryLayer | null = null;
	private roadMaskLayer: CesiumType.ImageryLayer | null = null;
	private lightningStage: LightningStage | null = null;
	// Path 1 cloud migration — Cesium-native billboard clouds behind the
	// world.useCesiumClouds flag. Default OFF; the existing CSS3D clouds
	// keep shipping until billboards look right.
	private cloudBillboardLayer: CloudBillboardLayer | null = null;
	private colorGradeStage: CesiumType.PostProcessStage | null = null;
	private lastQualityMode: QualityMode | null = null;

	// Phase 9: moonlight DirectionalLight that replaces scene.light at deep
	// night. Snapshot the original SunLight so we can swap back at dawn.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private moonlight: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private originalSunLight: any = null;
	private isUsingMoonlight = false;
	// Reusable Cartesian3s for moon-phase math (no per-frame allocation)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private _sunPos: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private _moonPos: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private _earthToMoon: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private _moonToSun: any = null;
	// Scratch Cartesian3 — reused by syncCamera every frame to avoid
	// per-frame allocation from Cartesian3.fromDegrees().
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private _scratchDest: any = null;

	// Effect sync caches
	private lastGlobeColor = '';
	private lastFogDensity = -1;
	private lastFogBrightness = -1;
	private lastLightIntensity = -1;
	private lastSkySatShift = 999;
	private lastSkyBrShift = 999;
	private lastExposure = -1;
	private lastAtmoLight = -1;
	private lastBuildingsShow = true;
	private lastClockLon = -999;
	private lastTimeOfDay = -1;
	private lastBuildingNightFactor = -1;
	private lastTerrainExaggeration = -1;
	// VIIRS write-skip cache. syncImagery() runs every tick; writing
	// the same alpha+brightness 60×/sec is a GPU sync cost we can
	// avoid by hashing the last applied values.
	private lastViirsAlpha = -1;
	private lastViirsBrightness = -1;
	private lastViirsShow: boolean | null = null;
	// PostProcessStage `enabled` toggle cache. At day (nf < 0.001) the
	// color-grade shader is mathematically pass-through (verified in
	// shaders.ts) — disabling the stage outright lets Cesium skip the
	// entire fullscreen render-to-texture pass on Pi 5. Only flip on
	// transition to avoid per-frame setter overhead.
	private lastColorGradeEnabled: boolean | null = null;

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
		// Disable Cesium's mouse/touch input on the globe. The flight engine
		// drives camera position programmatically via Cartesian3.fromDegrees;
		// user pan/rotate/zoom would fight that and let an accidental pointer
		// drag rotate the world. The kiosk surface is the blind + side panel,
		// not the globe itself.
		v.scene.screenSpaceCameraController.enableInputs = false;
		// Phase 9: ACES tonemap delivers richer blacks and brighter highlights
		// than the default PBR_NEUTRAL — punches the calm-amber direction.
		// Exposure starts neutral (1.0) and gets lerped by nightFactor in tick()
		// toward world.nightExposure. Zero GPU cost vs. PBR_NEUTRAL default.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.postProcessStages as any).tonemapper = (C as any).Tonemapper.ACES;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.postProcessStages as any).exposure = 1.0;
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
		// Cesium skyBox OFF — it ships the Tycho-2 catalog texture which
		// includes a diffuse MILKY WAY ARC that reads as a faint white band
		// across the night sky. With Three.js NightStars (1,200 stars with
		// spectral classes + magnitude + twinkle) + Meteors handling stellar
		// content, the Cesium skyBox is doubled-up and contributes only the
		// undesired Milky Way artifact. Disabled here at setup; the tick-loop
		// equivalent below is also flipped to false.
		if (v.scene.skyBox)
			(v.scene.skyBox as any).show = false;
		if (v.scene.sun) { v.scene.sun.show = true; v.scene.sun.glowFactor = 2.0; }
		// Cesium's built-in moon is OFF — the Three-side Moon component (in
		// world-three/Moon.svelte for the /playground/three composition) gives
		// us a larger, anti-sun, nightFactor-tied moon with full visual
		// control. Leaving Cesium's on would double-render the lunar disk.
		if (v.scene.moon) v.scene.moon.show = false;

		// Phase 9: snapshot the default SunLight so we can swap back at dawn,
		// pre-build the warm moonlight DirectionalLight (no per-frame alloc),
		// pre-allocate the Cartesian3s for moon-phase math.
		this.originalSunLight = v.scene.light;
		this.moonlight = new C.DirectionalLight({
			direction: new C.Cartesian3(0, 0, -1),
			color: new C.Color(0.95, 0.88, 0.78, 1.0),
			intensity: 0.0,
		});
		this._sunPos = new C.Cartesian3();
		this._moonPos = new C.Cartesian3();
		this._earthToMoon = new C.Cartesian3();
		this._moonToSun = new C.Cartesian3();
		this._scratchDest = new C.Cartesian3();

		this.#boundTick = this.tick.bind(this);
		v.scene.postRender.addEventListener(this.#boundTick);

		this.setupPostProcess(COLOR_GRADING_GLSL);
		await this.setupTerrain();
		await this.setupImagery();
		await this.setupBuildings();
		this.lightningStage = new LightningStage(C, v);
		this.lightningStage.mount();
		this.cloudBillboardLayer = new CloudBillboardLayer(C, v);
		this.cloudBillboardLayer.mount();

		// Phase 16: call tick once immediately to synchronize state (night,
		// camera, imagery) BEFORE the first render frame, avoiding the
		// "flash of day" on boot at night.
		this.tick();

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
			const allowBloom = this.model.config.world.qualityMode !== 'performance';
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
			if (existing) {
				this.colorGradeStage = existing as CesiumType.PostProcessStage;
			} else {
				const stage = new this.CesiumModule.PostProcessStage({
					name: 'aero-color-grade',
					fragmentShader: glsl,
					uniforms: {
						// Boot-faded so the post-process additive/desat/crush all
						// fade in together with the imagery layers — no "ground
						// goes dark before lights arrive" flicker.
						u_nightFactor: () => this.model.nightFactor * this.getBootFade(),
						u_lightIntensity: () => this.model.nightLightScale,
						u_additiveStrength: () => this.model.config.world.additiveStrength,
					},
				});
				v.scene.postProcessStages.add(stage);
				this.colorGradeStage = stage;
			}
		} catch (e) {
			console.warn('[CesiumManager] Post-process failed:', e);
		}
		// Apply initial enable state to bloom + color-grade based on qualityMode.
		this.syncQuality();
	}

	/**
	 * Keep post-process stage enable-state in sync with `config.world.qualityMode`.
	 *
	 * `performance` mode disables bloom AND the color-grade shader — these are
	 * the two GPU-heavy post-process stages and the autoQuality system flips
	 * here when Pi 5 frame budget can't keep up. The night look degrades to
	 * VIIRS + CartoDB + skyAtmosphere only; still legible, just without the
	 * pollution corona / shadow crush / contrast boost layered on top.
	 *
	 * Called from tick() every frame but no-ops unless `qualityMode` has
	 * changed since the last sync — Cesium tolerates per-frame writes to
	 * `stage.enabled` but we skip them anyway to keep the hot path clean.
	 */
	private syncQuality(): void {
		const mode = this.model.config.world.qualityMode;
		if (mode === this.lastQualityMode) return;
		this.lastQualityMode = mode;
		const allow = mode !== 'performance';
		const bloom = this.viewer?.scene.postProcessStages?.bloom;
		if (bloom) bloom.enabled = allow;
		if (this.colorGradeStage) this.colorGradeStage.enabled = allow;

		// Shadow maps cost 3-5ms GPU on Pi 5 — invisible at cruise altitude.
		// FXAA costs ~1ms — unnecessary since the post-process chain already
		// applies bloom + color-grade smoothing.
		const v = this.viewer;
		if (v.shadowMap) v.shadowMap.enabled = allow;
		(v.scene.postProcessStages as any).fxaa.enabled = allow;

		// Re-read bloom uniforms from config — previously only set at startup,
		// so admin panel changes to bloom controls were silently ignored.
		if (bloom && allow) {
			const w = this.model.config.world;
			bloom.uniforms.contrast = w.bloomContrast;
			bloom.uniforms.brightness = w.bloomBrightness;
			bloom.uniforms.sigma = w.bloomSigma;
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

		const tileBase = TILE_SERVER_URL?.replace(/\/$/, '');

		// CartoDB Dark — RESTORED Phase 17 from Feb-15's recipe. The dark
		// basemap has WHITE road lines on a near-black background; we punch
		// out the black with colorToAlpha(BLACK) and only the road grid
		// survives. ×4 brightness at deep night makes them glow sharp. Free
		// road geometry for the cost of one imagery layer + zero JS state
		// (vs. the deleted Overpass-fetching RoadLayer billboard collection).
		try {
			const cartoUrl = tileBase
				? `${tileBase}/cartodb-dark/{z}/{x}/{y}.png`
				: 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png';
			this.roadMaskLayer = this.viewer.imageryLayers.addImageryProvider(
				new C.UrlTemplateImageryProvider({
					url: cartoUrl,
					maximumLevel: 18,
					minimumLevel: 0,
					...(tileBase ? { tilingScheme: new C.WebMercatorTilingScheme() } : {}),
				}),
			);
			if (this.roadMaskLayer) {
				this.roadMaskLayer.alpha = 0;            // synced per-frame
				this.roadMaskLayer.show = false;
				this.roadMaskLayer.dayAlpha = 0;
				this.roadMaskLayer.nightAlpha = 1;
				this.roadMaskLayer.colorToAlpha = C.Color.BLACK;
				this.roadMaskLayer.colorToAlphaThreshold = 0.0;
				this.roadMaskLayer.saturation = 0.0;    // white/grey roads
				this.roadMaskLayer.contrast = 1.5;
				this.roadMaskLayer.brightness = 1.0;
			}
		} catch (e) {
			console.warn('[CesiumManager] CartoDB roads layer failed:', e);
		}

		// VIIRS night lights layer — NASA Black Marble via tile-packager cache.
		// Greyscale input → tinted amber via hue + saturation. ColorToAlpha
		// drops the near-black pixels so unlit terrain shows through.
		// Source: tools/tile-packager/src/sources.ts (viirs-night-lights).
		//
		// Upstream: swapped from VIIRS_CityLights_2012 (the legacy 2012 aggregate
		// where India's lit footprint was roughly half of today's) to the current
		// VIIRS_Black_Marble 2016 annual composite. Same z8 cap, same domain,
		// same date stamp — the only practical change is the layer name and a
		// dramatically larger / sharper night-light footprint over Hyderabad and
		// the rest of South Asia.
		try {
			const viirsUrl = tileBase
				? `${tileBase}/viirs-night-lights/{z}/{y}/{x}.jpg`
				: 'https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg';
			this.viirsLayer = this.viewer.imageryLayers.addImageryProvider(
				new C.UrlTemplateImageryProvider({
					url: viirsUrl,
					maximumLevel: 8, // VIIRS data only available through z8
					minimumLevel: 3,
					...(tileBase ? { tilingScheme: new C.WebMercatorTilingScheme() } : {}),
				}),
			);
			if (this.viirsLayer) {
				this.viirsLayer.alpha = 0;
				this.viirsLayer.show = false;
				// Day/night separation. globe.enableLighting=true would otherwise
				// MULTIPLY VIIRS by the sun-direction terminator shading, dimming
				// the lit-cities data on the night side — exactly the opposite of
				// what we want. dayAlpha=0 hides VIIRS on the lit hemisphere;
				// nightAlpha=1 keeps it full-bright on the dark hemisphere.
				this.viirsLayer.dayAlpha = 0;
				this.viirsLayer.nightAlpha = 1;
				// Dark pixels → transparent so only lit cells composite over terrain.
				this.viirsLayer.colorToAlpha = C.Color.BLACK;
				// Phase 16: desaturate VIIRS raster. Treating it as a grayscale-ish
				// light-intensity mask. The post-process shader picks up these
				// bright spots and paints them with the high-res hash-palette.
				// Kept 0.1 saturation so the shader's red-bias gate has a signal.
				this.viirsLayer.hue = 0.0;
				this.viirsLayer.saturation = 0.1;
				// Phase 16: boosted brightness + lowered threshold so more dim
				// light spots survive the mask stage to be amplified by shader.
				this.viirsLayer.brightness = 3.5 * this.model.config.world.viirsBrightness;
				this.viirsLayer.contrast = 1.4;
				// Phase 16: extremely sensitive threshold (0.02) to ensure
				// grayscale city lights are not accidentally cut out.
				this.viirsLayer.colorToAlphaThreshold = 0.02;
			}
		} catch (e) {
			console.warn('[CesiumManager] VIIRS layer failed:', e);
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
		this.syncCloudBillboards();
		this.syncLightning(dt);
		this.syncBuildings(dt);
		this.syncQuality();
	}

	/**
	 * Drive the Cesium-native cloud billboards. No-op when
	 * world.useCesiumClouds is false (the default). Repaints only when
	 * (location|weather|density|altitude-bucket) crosses a step.
	 */
	private syncCloudBillboards(): void {
		if (!this.cloudBillboardLayer) return;
		const m = this.model;
		this.cloudBillboardLayer.update(
			m.flight.lat,
			m.flight.lon,
			m.weather,
			m.config.atmosphere.clouds.density,
			m.flight.altitude,
			m.config.world.useCesiumClouds,
		);
	}

	/**
	 * Drive the lightning post-process stage. Composition picker fires
	 * a strike, the stage's flash uniform decays. Falls back to weather
	 * config when no composition is active (e.g. hasLightning was true
	 * at boot before the picker rolled).
	 */
	private syncLightning(dt: number): void {
		if (!this.lightningStage) return;
		const w = this.model.config.atmosphere.weather;
		this.lightningStage.tick(
			dt,
			w.hasLightning,
			w.lightningDecayRate,
			w.lightningMinInterval,
			w.lightningMaxInterval,
		);
	}

	private syncCamera(_dt: number): void {
		const f = this.model.flight;
		const mot = this.model.motion;

		// Phase 7 — multi-Pi parallax. For solo role (default), parallax
		// offset is 0 and this is a no-op. For left/center/right in a
		// panorama, the per-device yaw shifts the view so three Pis tile
		// into a continuous horizon band from the same shared flight state.
		// Uses model.flight.camHeading (SSOT smoothed).
		const parallaxHeading = this.model.config.camera.effectiveHeading(f.camHeading);

		const C = this.CesiumModule;
		// Cesium signature is fromDegrees(lon, lat, height, ellipsoid, result).
		// Passing `_scratchDest` as the 4th positional made Cesium treat it as
		// an ellipsoid (it has no .radiiSquared) → multiplyComponents got
		// undefined as `left` → DeveloperError stopped rendering. Pass
		// `undefined` for ellipsoid (defaults to WGS84) so `_scratchDest`
		// lands in the result slot it was always meant for.
		C.Cartesian3.fromDegrees(f.camLon, f.camLat, f.camAlt * 0.3048, undefined, this._scratchDest);
		// Bank → pitch coupling. Roll (below) only tilts the horizon; coupling
		// bank into pitch makes a turn actually reveal more GROUND (banking one
		// way) or more SKY (the other). Positive bank dips the view downward
		// (more negative pitch = more ground); negative bank lifts it. Applied
		// at display time from the live bankAngle so it never feeds back into
		// the pitch-smoothing loop. Coefficient is admin-tunable.
		const bankPitchCouple = this.model.config.camera.motion.bankPitchCouple ?? 0;
		const pitchDeg = (f.camPitch - 90) - bankPitchCouple * mot.bankAngle;
		this.viewer.camera.setView({
			destination: this._scratchDest,
			orientation: {
				heading: this.CesiumModule.Math.toRadians((parallaxHeading + 90) % 360),
				pitch: this.CesiumModule.Math.toRadians(pitchDeg),
				roll: this.CesiumModule.Math.toRadians(-mot.bankAngle),
			},
		});
	}

	private syncAtmosphere(): void {
		const m = this.model;
		const v = this.viewer;
		const C = this.CesiumModule;
		const nf = m.nightFactor;
		const dd = m.dawnDuskFactor;
		const isSunVisible = m.timeOfDay > T.DAWN_START && m.timeOfDay < T.DUSK_END;

		// Sync clock on time-of-day OR longitude change (>0.5°). Previously
		// only tracked timeOfDay — location changes across timezones left
		// the sun position frozen at the old UTC offset.
		if (this.lastTimeOfDay !== m.timeOfDay || Math.abs(this.lastClockLon - m.flight.lon) > 0.5) {
			this.lastTimeOfDay = m.timeOfDay;
			this.lastClockLon = m.flight.lon;
			if (v.scene.sun) v.scene.sun.show = isSunVisible;
			this.syncClock();
		}

		// Skybox OFF — see setup() for rationale. Guarded: only written
		// once (setup already sets false), skipped every frame after.
		if (v.scene.skyBox && (v.scene.skyBox as any).show !== false)
			(v.scene.skyBox as any).show = false;

		// Globe color: lerp day → night by nightFactor, then bias toward
		// duskBias proportional to dawnDuskFactor × duskWeight. Targets live
		// in $content/compositions/night.ts — edit there, not here.
		const G = NIGHT_PALETTE.globeColor;
		let r = lerp(lerp(G.day[0], G.night[0], nf), G.duskBias[0], dd * G.duskWeight);
		let g = lerp(lerp(G.day[1], G.night[1], nf), G.duskBias[1], dd * G.duskWeight);
		let b = lerp(lerp(G.day[2], G.night[2], nf), G.duskBias[2], dd * G.duskWeight);
		const colorKey = `${r},${g},${b}`;
		if (colorKey !== this.lastGlobeColor) {
			this.lastGlobeColor = colorKey;
			v.scene.globe.baseColor = C.Color.fromBytes(Math.round(r), Math.round(g), Math.round(b), 255);
		}

		// Cesium skyAtmosphere — saturation + brightness shift. Lerps day →
		// night by nightFactor, then ADDS dawn/dusk bias (negative — pulls
		// saturation slightly down to cancel cyan limb banding, brightness
		// slightly down for the blue-hour beat). brightness ALSO scaled by
		// world.skyDarken (operator on-site knob). Targets in NIGHT_PALETTE.
		const S = NIGHT_PALETTE.skyAtmosphere;
		const satShift = lerp(S.satShift.day, S.satShift.night, nf) + dd * S.satShift.duskBias;
		const brShift = (lerp(S.brShift.day, S.brShift.night, nf) * this.model.config.world.skyDarken)
			+ dd * S.brShift.duskBias;
		// Guard bug fix: previously only checked satShift, which is constant
		// at deep night (-1.0). brShift changes from skyDarken slider were
		// silently dropped, making the operator knob inert. Each shift now
		// guards independently.
		const satChanged = Math.abs(satShift - this.lastSkySatShift) > 0.01;
		const brChanged = Math.abs(brShift - this.lastSkyBrShift) > 0.01;
		if ((satChanged || brChanged) && v.scene.skyAtmosphere) {
			if (satChanged) {
				v.scene.skyAtmosphere.saturationShift = satShift;
				this.lastSkySatShift = satShift;
			}
			if (brChanged) {
				v.scene.skyAtmosphere.brightnessShift = brShift;
				this.lastSkyBrShift = brShift;
			}
		}

		const fog = m.sceneFog;
		const targetDensity = lerp(fog.dayDensity, fog.nightDensity, nf) * (1 + m.config.atmosphere.haze.amount * 8);
		const targetBrightness = lerp(fog.dayBrightness, fog.nightBrightness, nf);
		if (Math.abs(targetDensity - this.lastFogDensity) > 0.00001) {
			this.lastFogDensity = targetDensity;
			if (v.scene.fog) {
				v.scene.fog.enabled = targetDensity > 0.00001;
				v.scene.fog.density = targetDensity;
				// Phase 10 / 11b — visualDensityScalar adds aerial-perspective
				// haze on the horizon without increasing tile-cull density
				// (no pop-in). Bumped 1.5→2.4 after the DOM HazeEffect was
				// deleted so Cesium fog alone carries the horizon-band haze
				// that the screen-anchored gradient used to provide.
				// Also picks up the per-location haze multiplier
				// (atmosphere.haze.intensity) so mountain locations get
				// crisper air, ocean locations get thicker.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(v.scene.fog as any).visualDensityScalar = 1.0 + 2.4 * nf + m.config.atmosphere.haze.amount * 4;
			}
		}
		if (Math.abs(targetBrightness - this.lastFogBrightness) > 0.01) {
			this.lastFogBrightness = targetBrightness;
			if (v.scene.fog) v.scene.fog.minimumBrightness = targetBrightness;
		}

		// Phase 9 scene-lighting: at deep night swap to a warm moonlight
		// DirectionalLight, modulated by computed lunar phase. Outside deep
		// night, restore SunLight (whose direction is sun-position-driven).
		// Skipping when isLeader=false won't matter (this fn is camera-side).
		const w = this.model.config.world;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const Cany = C as any;

		// Compute moon phase from real planetary positions.
		let moonPhase = 1.0;
		try {
			const julianDate = v.clock.currentTime;
			Cany.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(julianDate, this._sunPos);
			Cany.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(julianDate, this._moonPos);
			C.Cartesian3.normalize(this._moonPos, this._earthToMoon);
			C.Cartesian3.subtract(this._sunPos, this._moonPos, this._moonToSun);
			C.Cartesian3.normalize(this._moonToSun, this._moonToSun);
			const cosPhase = C.Cartesian3.dot(this._earthToMoon, this._moonToSun);
			moonPhase = (1.0 - cosPhase) * 0.5;
		} catch {
			// phase = 1.0 fallback
		}
		const phaseFactor = 0.7 + 0.3 * moonPhase;
		const moonlightIntensity = nf > 0.01 ? Math.max(w.moonlightIntensity * nf * phaseFactor, 0.035) : 0;

		// Swap light source at the day↔night boundary (hysteresis to prevent
		// flapping at the threshold).
		if (nf > 0.85 && !this.isUsingMoonlight) {
			v.scene.light = this.moonlight;
			this.isUsingMoonlight = true;
		} else if (nf < 0.65 && this.isUsingMoonlight) {
			v.scene.light = this.originalSunLight;
			this.isUsingMoonlight = false;
		}

		if (this.isUsingMoonlight && this.moonlight) {
			this.moonlight.intensity = moonlightIntensity;
			// Phase 10 (Council Critic catch): we already compute the real moon
			// position via Simon1994 above. Use it as the DirectionalLight
			// direction instead of the hardcoded (0,0,-1) "straight down" — gives
			// physically-correct moon-angle shadows on buildings + terrain.
			// Light direction is FROM moon TO Earth, so negate _earthToMoon.
			C.Cartesian3.negate(this._earthToMoon, this.moonlight.direction);
		} else {
			const targetIntensity = lerp(1.0, 0.02, nf);
			if (Math.abs(targetIntensity - this.lastLightIntensity) > 0.01) {
				this.lastLightIntensity = targetIntensity;
				if (v.scene.light) v.scene.light.intensity = targetIntensity;
			}
		}

		// Exposure + atmosphereLight lerps. Day anchors live in NIGHT_PALETTE;
		// night targets are operator-tunable so we read from world config.
		// Cache-guarded: Cesium triggers GPU uniform uploads on property
		// writes, so we skip when the value hasn't meaningfully changed.
		const targetExposure
			= NIGHT_PALETTE.scene.exposureDay + (w.nightExposure - NIGHT_PALETTE.scene.exposureDay) * nf;
		if (Math.abs(targetExposure - this.lastExposure) > 0.005) {
			this.lastExposure = targetExposure;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v.scene.postProcessStages as any).exposure = targetExposure;
		}
		const targetAtmoLight
			= NIGHT_PALETTE.scene.atmosphereLightDay
			+ (w.atmosphereLight - NIGHT_PALETTE.scene.atmosphereLightDay) * nf;
		if (Math.abs(targetAtmoLight - this.lastAtmoLight) > 0.005) {
			this.lastAtmoLight = targetAtmoLight;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v.scene.globe as any).atmosphereLightIntensity = targetAtmoLight;
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
		const bootFade = this.getBootFade();

		const show = nf > 0.01;
		const firstNight = this.lastNightFactor < 0.01 && nf > 0.01;
		this.lastNightFactor = nf;

		// Base imagery tonemap — desaturate + darken EOX as night falls so the
		// vivid green-yellow Sentinel-2 colors don't bleed through as a hue
		// cast under the shader's navy tint. Same 0.45→0.9 smoothstep curve
		// the (removed) CartoDB overlay used so the "blue hour" beat — sky
		// commits to darkness before city lights ignite — survives.
		const baseEase = smoothstep((nf - 0.45) / (0.9 - 0.45));

		const w = this.model.config.world;
		if (this.baseLayer) {
			// Brightness lerp removed in Phase 15.5: the shader's mix() to navy
			// (in COLOR_GRADING_GLSL) already darkens the scene at night. Keeping
			// the imagery-layer brightness lerp would double-darken — visible as
			// a too-dark navy floor with no detail. Saturation lerp stays —
			// removes the green Sentinel-2 hue cast so the shader's navy tint
			// reads cleanly. baseLayer.brightness stays at its day value of 1.0.
			this.baseLayer.saturation = lerp(this.baseDaySaturation, w.baseNightSaturation, baseEase);
		}

		// VIIRS lights fade in at night. Cap at 0.5 (was 0.9) so the amber
		// overlay reads as "lit terrain" rather than washing the whole
		// surface with VIIRS colour. The shader-driven base darkening now
		// carries the sky/ocean dim load; VIIRS is the additive accent
		// confined to the lit cells by colorToAlpha.
		//
		// Smoothstep curve (NIGHT_PALETTE.viirs.smoothstepFloor..Ceil = 0.55..0.9).
		// Floor at 0.55 prevents the "magenta leak" that hue-rotated colorToAlpha
		// produced on bright city cores at early dusk. Thresholds + cap live
		// in $content/compositions/night.ts for discoverability.
		if (this.viirsLayer) {
			const V = NIGHT_PALETTE.viirs;
			const viirsEase = smoothstep(
				(nf - V.smoothstepFloor) / (V.smoothstepCeil - V.smoothstepFloor),
			);
			// Phase 6 (altitude-gate VIIRS): smoothstep gate fades VIIRS to
			// zero below 5kft so the building emissive (Phase 3) and future
			// vector roads (Phase 5) own the city-light load at low altitude
			// without VIIRS' photoreal aggregate overpainting them.
			const altGate = smoothstep(
				(this.model.flight.altitude - w.viirsAltGateLowFt) /
					Math.max(w.viirsAltGateHighFt - w.viirsAltGateLowFt, 1),
			);
			// Phase 9 viirsAlphaBoost — multiplies the post-Phase-6 alpha so the
			// night map punches through the navy-mix that the new shader's
			// lightMask still gates. Lerped by nf so day = no boost.
			const boost = 1.0 + (w.viirsAlphaBoost - 1.0) * nf;
			const viirsAlpha = Math.min(V.maxAlpha * viirsEase * scale * altGate * boost, 1.0) * bootFade;
			const viirsShow = (show || firstNight) && viirsAlpha > 0.001;
			const viirsBrightness = 2.2 * w.viirsBrightness;
			// Write-skip: only flush to the imagery layer when one of the
			// three controlled values has changed by more than its just-
			// noticeable epsilon. Tightens the per-frame GPU sync cost on
			// Pi 5; the admin SidePanel slider still feels live because the
			// epsilon is below human perception (~0.5% alpha, ~1% bright).
			if (viirsShow !== this.lastViirsShow) {
				this.viirsLayer.show = viirsShow;
				this.lastViirsShow = viirsShow;
			}
			if (Math.abs(viirsAlpha - this.lastViirsAlpha) > 0.001) {
				this.viirsLayer.alpha = viirsAlpha;
				this.lastViirsAlpha = viirsAlpha;
			}
			if (Math.abs(viirsBrightness - this.lastViirsBrightness) > 0.01) {
				this.viirsLayer.brightness = viirsBrightness;
				this.lastViirsBrightness = viirsBrightness;
			}
		}

		// CartoDB road mask — altitude-crossfaded against VIIRS.
		//
		// VIIRS (above) ramps IN as altitude climbs (5k→15k via viirsAltGate);
		// CartoDB ramps OUT as altitude climbs (15k→35k via roadAltGate). Both
		// layers overlap fully in the 15k–25k passenger-window band so the
		// transition reads as a smooth blend rather than a swap. At cruise
		// (35k+) CartoDB holds at ~40% so the street skeleton still ghosts
		// through the amber wash; at descent (<15k) CartoDB carries the
		// detail load while VIIRS has faded out.
		if (this.roadMaskLayer) {
			const altRampLowFt  = 15000;
			const altRampHighFt = 35000;
			const altRamp = clamp(
				(this.model.flight.altitude - altRampLowFt) /
					(altRampHighFt - altRampLowFt),
				0,
				1,
			);
			// 1.0 at low altitude → 0.4 at cruise.
			const roadAltGate = 1.0 - altRamp * 0.6;
			// Roads have a small daytime baseline (12 %) so the city skeleton
			// reads slightly through the satellite imagery at every hour, not
			// only at night. At night the night component dominates; daytime
			// is just a hint of the road structure. Both rise together with
			// the boot fade.
			const ROAD_DAY_BASE = 0.12;
			const nightComponent = nf * scale * roadAltGate;
			const dayComponent   = (1 - nf) * ROAD_DAY_BASE * roadAltGate;
			this.roadMaskLayer.show = true;
			this.roadMaskLayer.alpha = (nightComponent + dayComponent) * bootFade;
			this.roadMaskLayer.brightness = lerp(1.6, 4.0, nf) * Math.max(scale, 0.5);
		}

		// Disable the color-grade PostProcessStage at full day — the shader is
		// already a verified passthrough at nf < 0.001 (see shaders.ts early-
		// exit), and disabling the stage outright skips the entire fullscreen
		// render-to-texture pass. syncQuality() owns the on/off in performance
		// mode; we only force OFF here, never ON (so qualityMode override
		// wins). Threshold matches the shader's so transitions stay seamless.
		if (this.colorGradeStage && this.lastQualityMode !== 'performance') {
			const shouldEnable = nf >= 0.001;
			if (shouldEnable !== this.lastColorGradeEnabled) {
				this.colorGradeStage.enabled = shouldEnable;
				this.lastColorGradeEnabled = shouldEnable;
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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const C: any = this.CesiumModule;
		try {
			this.tileset = await this.CesiumModule.createOsmBuildingsAsync();
			if (this.tileset) {
				this.tileset.show = this.model.config.world.buildingsEnabled;
				this.tileset.maximumScreenSpaceError = CESIUM_QUALITY_PRESETS.balanced.maximumScreenSpaceError;
				this.tileset.shadows = this.CesiumModule.ShadowMode.ENABLED;
				this.tileset.colorBlendMode = this.CesiumModule.Cesium3DTileColorBlendMode.HIGHLIGHT;
				// Procedural lit-window shader — restored Feb 15 recipe via
				// Cesium CustomShader API. Per-fragment grid math, no
				// per-feature property dependency. Uniforms updated each
				// frame in syncBuildings.
				try {
					this.buildingsShader = new C.CustomShader({
						mode: C.CustomShaderMode.MODIFY_MATERIAL,
						lightingModel: C.LightingModel.UNLIT,
						uniforms: {
							u_nightFactor:    { type: C.UniformType.FLOAT, value: 0.0 },
							u_lightIntensity: { type: C.UniformType.FLOAT, value: 1.0 },
							u_windowDensity:  { type: C.UniformType.FLOAT, value: 0.0 },
							u_time:           { type: C.UniformType.FLOAT, value: 0.0 },
						},
						// Model-space normal isn't available in the fragment
						// stage in modern Cesium; pass it through as a varying.
						varyings: {
							v_normalMC: C.VaryingType.VEC3,
						},
						vertexShaderText: BUILDING_VERTEX_GLSL,
						fragmentShaderText: BUILDING_SHADER_GLSL,
					});
					this.tileset.customShader = this.buildingsShader;
				} catch (e) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const msg = (e as any)?.message ?? String(e);
					console.warn('[CesiumBuildings] Custom shader failed; falling back to uniform amber style:', msg);
					this.buildingsShader = null;
				}
				this.viewer.scene.primitives.add(this.tileset);
			}
		} catch (e) { console.warn('[CesiumBuildings] OSM buildings unavailable:', (e as Error).message); }
	}

	private syncBuildings(dt: number): void {
		if (!this.tileset) return;
		const show = this.model.config.world.buildingsEnabled;
		if (show !== this.lastBuildingsShow) {
			this.lastBuildingsShow = show;
			this.tileset.show = show;
		}

		const w = this.model.config.world;
		const lo = w.buildingEmissiveLowAltFt;
		const hi = w.buildingEmissiveHighAltFt;
		const altBlend = clamp((this.model.flight.altitude - lo) / Math.max(hi - lo, 1), 0, 1);
		const nf = this.model.nightFactor;
		const scale = this.model.nightLightScale;

		// Procedural shader path — update uniforms each frame. The shader
		// composes window emission internally; we only drive the time +
		// global gates here. Cheap; the shader handles the rest.
		if (this.buildingsShader) {
			const bootFade = this.getBootFade();
			this.buildingsTime += dt;        // frame-rate independent
			// nightFactor is gated by bootFade so the emissive ramps in alongside
			// VIIRS + road mask instead of snapping on while base tiles stream.
			this.buildingsShader.setUniform('u_nightFactor', nf * bootFade);
			this.buildingsShader.setUniform('u_lightIntensity', scale);
			// Window density tapers as altitude rises — at cruise we don't
			// need full per-window granularity, just a glow signature.
			this.buildingsShader.setUniform('u_windowDensity', nf * 0.4 * scale * (1 - altBlend));
			this.buildingsShader.setUniform('u_time', this.buildingsTime);
			return;
		}

		// Fallback path when custom shader unavailable — uniform amber.
		if (
			Math.abs(nf - this.lastBuildingNightFactor) < 0.01 &&
			Math.abs(altBlend - this.lastBuildingAltBlend) < 0.02
		) return;
		this.lastBuildingNightFactor = nf;
		this.lastBuildingAltBlend = altBlend;
		const alphaValue = (w.buildingEmissiveMax * nf * (1 - altBlend)).toFixed(3);
		this.tileset.style = new this.CesiumModule.Cesium3DTileStyle({
			color: `color("rgb(255, 180, 90)", ${alphaValue})`,
		});
	}


	applyQualityMode(mode: QualityMode): void {
		const p = CESIUM_QUALITY_PRESETS[mode];
		const globe = this.viewer.scene.globe;
		globe.maximumScreenSpaceError = p.maximumScreenSpaceError;
		globe.tileCacheSize = p.tileCacheSize;
		globe.preloadSiblings = p.preloadSiblings;
		globe.preloadAncestors = p.preloadAncestors;
		globe.loadingDescendantLimit = p.loadingDescendantLimit;
		if (this.tileset) this.tileset.maximumScreenSpaceError = p.maximumScreenSpaceError;
	}

	/**
	 * Render the OSM buildings tileset as a wireframe ("line marks"
	 * tracing the building geometry) instead of filled cubes. Used by
	 * the /playground/three composition lab to give the Tron-esque
	 * outline aesthetic while keeping the real OSM data. Cesium's
	 * `debugWireframe` is officially a debug feature but is the standard
	 * way to get wireframe rendering on a 3D Tiles primitive.
	 *
	 * Requires WEBGL_polygon_offset (WebGL1) or native WebGL2; modern
	 * browsers all qualify. Silent no-op if the tileset isn't loaded yet.
	 */
	setBuildingsWireframe(enabled: boolean): void {
		if (!this.tileset) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(this.tileset as any).debugWireframe = enabled;
	}

	destroy(): void {
		if (this.lightningStage) {
			this.lightningStage.destroy();
			this.lightningStage = null;
		}
		if (this.cloudBillboardLayer) {
			this.cloudBillboardLayer.destroy();
			this.cloudBillboardLayer = null;
		}
		if (!this.viewer.isDestroyed()) {
			if (this.#boundTick) {
				this.viewer.scene.postRender.removeEventListener(this.#boundTick);
			}
			this.viewer.destroy();
		}
	}
}
