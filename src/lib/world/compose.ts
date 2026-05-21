/**
 * CesiumManager — consolidated Cesium globe engine.
 *
 * Single file for: Viewer lifecycle, terrain, buildings, imagery,
 * atmosphere sync, post-processing, and the per-frame render loop.
 */

import type * as CesiumType from 'cesium';
import type { LocationId, WeatherType, QualityMode } from '$lib/types';
import { world } from '$lib/model/config-tree.svelte';
import { normalizeHeading, shortestAngleDelta, lerp, smoothstep, clamp } from '$lib/utils';
import { T } from '$lib/night';
import { NIGHT_PALETTE } from '$content/compositions/night';
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
		atmosphere: { haze: { amount: number } };
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
	private lastBuildingAltBlend = -1;
	private lastNightFactor = -1;
	// Imagery Layers
	// baseLayer: Sentinel-2 / ESRI / Mapbox terrain texture — dimmed + desaturated
	//   as night falls. The vivid day EOX boost is kept via baseDay* caches so
	//   we can lerp between day-vivid and night-dark.
	// (Phase 15.5 P2: CartoDB Dark imagery layer dropped. Its atmospheric
	//   darkening function is now a 3-line mix() in COLOR_GRADING_GLSL. Saves
	//   one Cesium imagery layer per fragment, plus ~180MB tile cache.)
	// viirsLayer: NASA VIIRS Black Marble night lights — real satellite
	//   nightlight imagery (z3-z8, 500m/px). Replaces the procedural
	//   hash-palette the shader used to invent. ColorToAlpha hides dark
	//   (unlit) pixels; hue+saturation tint the greyscale toward sodium
	//   amber. Only visible at night via alpha gated on nightFactor.
	private baseLayer: CesiumType.ImageryLayer | null = null;
	private baseDaySaturation = 1.0;
	private baseDayContrast = 1.0;
	private viirsLayer: CesiumType.ImageryLayer | null = null;
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

	// Effect sync caches
	private lastGlobeColor = '';
	private lastFogDensity = -1;
	private lastFogBrightness = -1;
	private lastLightIntensity = -1;
	private lastSkySatShift = 999;
	private lastTimeOfDay = -1;
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
		if (v.scene.skyBox)
			(v.scene.skyBox as any).show = true;
		if (v.scene.sun) { v.scene.sun.show = true; v.scene.sun.glowFactor = 2.0; }
		if (v.scene.moon) v.scene.moon.show = true;

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
						u_nightFactor: () => this.model.nightFactor,
						u_lightIntensity: () => this.model.nightLightScale,
						// Phase 9 — Apr-15 hash palette uniforms from world config.
						u_paletteSpread: () => this.model.config.world.paletteSpread,
						u_additiveStrength: () => this.model.config.world.additiveStrength,
						u_redSparkRate: () => this.model.config.world.redSparkRate,
						u_darkVoidStrength: () => this.model.config.world.darkVoidStrength,
						u_envLight: () => this.model.config.world.envLight,
						u_viirsMaskStrength: () => this.model.config.world.viirsMaskStrength,
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

		// (CartoDB Dark imagery overlay removed in Phase 15.5. Atmospheric
		// darkening is now a 3-line mix() in COLOR_GRADING_GLSL gated by the
		// same 0.45→0.9 smoothstep curve. -1 Cesium imagery layer, -1 GPU
		// texture sample per fragment, ~180MB tile cache reclaimed.)

		const tileBase = TILE_SERVER_URL?.replace(/\/$/, '');

		// VIIRS night lights layer — NASA Black Marble via tile-packager cache.
		// Greyscale input → tinted amber via hue + saturation. ColorToAlpha
		// drops the near-black pixels so unlit terrain shows through.
		// Source: tools/tile-packager/src/sources.ts (viirs-night-lights).
		try {
			const viirsUrl = tileBase
				? `${tileBase}/viirs-night-lights/{z}/{y}/{x}.jpg`
				: 'https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_CityLights_2012/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg';
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
				this.viirsLayer.colorToAlphaThreshold = 0.12;
				// Greyscale → sodium amber. hue offset + reduced saturation + boost.
				this.viirsLayer.hue = 0.08;
				this.viirsLayer.saturation = 0.55;
				// Phase 9 — VIIRS brightness × world.viirsBrightness so operators
				// can punch the night map. Base 2.2 × default 1.5 = 3.3.
				this.viirsLayer.brightness = 2.2 * this.model.config.world.viirsBrightness;
				this.viirsLayer.contrast = 1.3;
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
		this.syncBuildings();
		this.syncQuality();
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

		const isSunVisible = m.timeOfDay > T.DAWN_START && m.timeOfDay < T.DUSK_END;
		if (this.lastTimeOfDay !== m.timeOfDay) {
			this.lastTimeOfDay = m.timeOfDay;
			if (v.scene.sun) v.scene.sun.show = isSunVisible;
			this.syncClock();
		}

		// Skybox stays on always — vite-plugin-static-copy serves the SkyBox
		// star textures from /cesiumStatic/Assets/Textures/SkyBox/, so night
		// gets a real starfield. (Earlier workaround disabled it because of
		// a stale-build issue — fixed at the static-asset config layer now.)
		if (v.scene.skyBox)
			(v.scene.skyBox as any).show = true;

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
		if (Math.abs(satShift - this.lastSkySatShift) > 0.01) {
			this.lastSkySatShift = satShift;
			if (v.scene.skyAtmosphere) {
				v.scene.skyAtmosphere.saturationShift = satShift;
				v.scene.skyAtmosphere.brightnessShift = brShift;
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
				// Phase 10 (Council researcher catch): visualDensityScalar adds
				// aerial-perspective haze on the horizon WITHOUT increasing
				// tile-cull density (which would cause pop-in). At cruise we
				// want thick visible haze + normal LOD. Lerp 1.0 (day) → 2.5
				// (deep night) for stronger atmospheric depth at night.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(v.scene.fog as any).visualDensityScalar = 1.0 + 1.5 * nf;
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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.postProcessStages as any).exposure
			= NIGHT_PALETTE.scene.exposureDay + (w.nightExposure - NIGHT_PALETTE.scene.exposureDay) * nf;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.globe as any).atmosphereLightIntensity
			= NIGHT_PALETTE.scene.atmosphereLightDay
			+ (w.atmosphereLight - NIGHT_PALETTE.scene.atmosphereLightDay) * nf;
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
		// Smoothstep curve (VIIRS_SMOOTHSTEP_FLOOR..CEIL = 0.55..0.9). Floor
		// at 0.55 prevents the "magenta leak" that hue-rotated colorToAlpha
		// produced on bright city cores at early dusk. Thresholds + cap live
		// in $lib/night for discoverability.
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
			const viirsAlpha = Math.min(V.maxAlpha * viirsEase * scale * altGate * boost, 1.0);
			this.viirsLayer.show = (show || firstNight) && viirsAlpha > 0.001;
			this.viirsLayer.alpha = viirsAlpha;
			// Phase 10 — viirsBrightness rewritten per-frame so the admin
			// SidePanel slider takes effect live. Compose.ts originally set
			// it once at setup; that meant slider changes required reload.
			this.viirsLayer.brightness = 2.2 * w.viirsBrightness;
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
				this.tileset.show = this.model.config.world.buildingsEnabled;
				this.tileset.maximumScreenSpaceError = CESIUM_QUALITY_PRESETS.balanced.maximumScreenSpaceError;
				// Cast + receive shadows — buildings drop long shadows across
				// the terrain at low-sun times, grounding them in the scene.
				this.tileset.shadows = this.CesiumModule.ShadowMode.ENABLED;
				// Phase 3 (variant E productionized): HIGHLIGHT blend multiplies
				// the source pixel by the style color (amber), so glow rides on
				// top of the per-face shading rather than overpainting it. This
				// is also Cesium's default, set explicitly for clarity.
				this.tileset.colorBlendMode = this.CesiumModule.Cesium3DTileColorBlendMode.HIGHLIGHT;
				this.viewer.scene.primitives.add(this.tileset);
			}
		} catch (e) { console.warn('[CesiumBuildings] OSM buildings unavailable:', (e as Error).message); }
	}

	private syncBuildings(): void {
		if (!this.tileset) return;
		this.tileset.show = this.model.config.world.buildingsEnabled;

		// Phase 3 (variant E productionized): amber emissive at low altitude,
		// fades above cruise. altBlend = 0 below low, 1 above high; alpha pinned
		// to nightFactor so daytime falls out naturally.
		const w = this.model.config.world;
		const lo = w.buildingEmissiveLowAltFt;
		const hi = w.buildingEmissiveHighAltFt;
		const altBlend = clamp((this.model.flight.altitude - lo) / Math.max(hi - lo, 1), 0, 1);
		const nf = this.model.nightFactor;

		// Throttle: re-style only when either knob has moved a perceptible step.
		// Altitude bobs ~±100ft during cruise turbulence — the 0.02 altBlend
		// threshold maps to ~200ft of climb/descent, well above turbulence noise.
		if (
			Math.abs(nf - this.lastBuildingNightFactor) < 0.01 &&
			Math.abs(altBlend - this.lastBuildingAltBlend) < 0.02
		) return;
		this.lastBuildingNightFactor = nf;
		this.lastBuildingAltBlend = altBlend;

		const alpha = w.buildingEmissiveMax * nf * (1 - altBlend);
		this.tileset.style = new this.CesiumModule.Cesium3DTileStyle({
			color: `color("rgb(255, 180, 90)", ${alpha.toFixed(3)})`,
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

	destroy(): void {
		if (!this.viewer.isDestroyed()) {
			if (this.#boundTick) {
				this.viewer.scene.postRender.removeEventListener(this.#boundTick);
			}
			this.viewer.destroy();
		}
	}
}
