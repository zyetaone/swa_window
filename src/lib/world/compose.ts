/**
 * CesiumManager — thin orchestrator for the Cesium globe.
 *
 * Sub-managers (constructor-injected with Cesium + Viewer):
 *   CameraManager           — orientation, parallax, scratch Cartesian3
 *   AtmosphereManager       — sky, fog, globe color, moonlight, exposure
 *   TerrainManager          — terrain provider + exaggeration
 *   ImageryManager          — base imagery, VIIRS, CartoDB roads
 *   BuildingsManager        — OSM 3D Tiles + procedural shader
 *   LightningManager        — post-process lightning flash
 *   CloudBillboardManager   — Cesium-native cloud bank
 *   ColorGradeManager       — post-process night grading
 *
 * Owns directly: viewer lifecycle, post-process stage enumeration
 * (bloom, AO, FXAA) plus the per-frame tick + quality transition.
 */

import type * as CesiumType from 'cesium';
import type { LocationId, WeatherType, QualityMode } from '$lib/types';
import { world } from '$lib/model/config-tree.svelte';
import { T } from '$lib/utils';
import { VIEWER_OPTIONS, applySceneDefaults } from './cesium-setup';
import { CESIUM_QUALITY_PRESETS } from './model';
import { ImageryManager } from './imagery';
import { BuildingsManager } from './buildings';
import { AtmosphereManager } from './atmosphere-manager';
import { TerrainManager } from './terrain-manager';
import { LightningManager } from './lightning-manager';
import { CloudBillboardManager } from './cloud-billboard-manager';
import { ColorGradeManager } from './color-grade-manager';
import { CameraManager } from './camera-manager';

type WorldConfig = typeof world;

interface CesiumModelView {
	flight: {
		lat: number; lon: number; altitude: number; heading: number; pitch: number;
		camLat: number; camLon: number; camAlt: number; camHeading: number; camPitch: number;
	};
	motion: { bankAngle: number };
	config: {
		camera: {
			effectiveHeading(baseHeading: number): number;
			motion: { bankPitchCouple: number };
			flyoverPitchDeg: number;
		};
		world: WorldConfig;
		atmosphere: {
			haze: { amount: number };
			clouds: { density: number; speed: number; layerCount: number };
			weather: {
				hasLightning: boolean; lightningDecayRate: number;
				lightningMinInterval: number; lightningMaxInterval: number;
			};
		};
	};
	timeOfDay: number; nightFactor: number; dawnDuskFactor: number;
	nightLightScale: number; qualityMode: QualityMode;
	location: LocationId; weather: WeatherType;
	sceneFog: { dayDensity: number; nightDensity: number; dayBrightness: number; nightBrightness: number };
	terrainExaggeration: number;
}

export class CesiumManager {
	readonly #C: typeof CesiumType;
	readonly #model: CesiumModelView;
	readonly #viewer: CesiumType.Viewer;

	readonly #camera: CameraManager;
	readonly #atmosphere: AtmosphereManager;
	readonly #terrain: TerrainManager;
	readonly #imagery: ImageryManager;
	readonly #buildings: BuildingsManager;
	readonly #lightning: LightningManager;
	readonly #cloudBillboards: CloudBillboardManager;
	readonly #colorGrade: ColorGradeManager;

	#lastQualityMode: QualityMode | null = null;
	#lastPostRenderTime = performance.now();
	#boundTick: (() => void) | null = null;
	#started = false;

	#bootStartMs: number | null = null;
	static readonly BOOT_FADE_MS = 1600;
	#getBootFade(): number {
		if (this.#bootStartMs === null) this.#bootStartMs = performance.now();
		const t = (performance.now() - this.#bootStartMs) / CesiumManager.BOOT_FADE_MS;
		return t >= 1 ? 1 : t < 0 ? 0 : t;
	}

	constructor(model: CesiumModelView, CesiumModule: typeof CesiumType, container: HTMLElement) {
		this.#C = CesiumModule;
		this.#model = model;
		this.#viewer = new CesiumModule.Viewer(container, VIEWER_OPTIONS);
		this.#camera = new CameraManager(CesiumModule, this.#viewer);
		this.#atmosphere = new AtmosphereManager(CesiumModule, this.#viewer);
		this.#terrain = new TerrainManager(CesiumModule, this.#viewer);
		this.#imagery = new ImageryManager(CesiumModule, this.#viewer);
		this.#buildings = new BuildingsManager(CesiumModule, this.#viewer);
		this.#lightning = new LightningManager(CesiumModule, this.#viewer);
		this.#cloudBillboards = new CloudBillboardManager(CesiumModule, this.#viewer);
		this.#colorGrade = new ColorGradeManager(CesiumModule, this.#viewer, '' /* set in start */);
	}

	getViewer(): CesiumType.Viewer { return this.#viewer; }
	getCesium(): typeof CesiumType { return this.#C; }

	/**
	 * Camera state in a project-frame-friendly shape. CameraMirror (and any
	 * other system that needs to mirror Cesium's camera each frame) reads
	 * through this instead of reaching into `viewer.camera.positionWC`
	 * directly. Plain `{x,y,z}` objects + a scalar fov, no Cesium types.
	 */
	getCameraRead(): { position: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number }; up: { x: number; y: number; z: number }; fovDeg: number } {
		const cam = this.#viewer.camera;
		const p = cam.positionWC;
		const d = cam.directionWC;
		const u = cam.upWC;
		// Frustum is PerspectiveFrustum in CesiumManager's setup. Narrow cast
		// to read fovy — same cast CameraMirror used inline.
		const fovy = (cam.frustum as { fovy: number }).fovy;
		const fovDeg = Number.isFinite(fovy) ? (fovy * 180) / Math.PI : NaN;
		return {
			position: { x: p.x, y: p.y, z: p.z },
			direction: { x: d.x, y: d.y, z: d.z },
			up: { x: u.x, y: u.y, z: u.z },
			fovDeg,
		};
	}

	// ── Start ────────────────────────────────────────────────────────────────

	async start(COLOR_GRADING_GLSL: string): Promise<void> {
		if (this.#started) return;
		this.#started = true;
		const v = this.#viewer;

		applySceneDefaults(v, this.#C);
		this.#atmosphere.init(this.#C, v);
		this.#camera.setup();

		this.#boundTick = this.#tick.bind(this);
		v.scene.postRender.addEventListener(this.#boundTick);

		// ColorGrade is constructed in the ctor with an empty GLSL; pass the
		// real one to setup() now that we have it (start() is the only call
		// site that has the shader source — it's loaded from the side panel).
		(this.#colorGrade as { setup(glsl: string): void }).setup(COLOR_GRADING_GLSL);
		this.#setupPostProcess();
		await this.#terrain.setup();
		await this.#imagery.setup();
		await this.#buildings.setup(this.#model.config.world.buildingsEnabled);
		this.#lightning.setup();
		this.#cloudBillboards.setup();

		this.#syncClock();
		this.#tick();
		v.resize();
		v.scene.requestRender();
	}

	#syncClock(): void {
		const C = this.#C;
		const h = ((this.#model.timeOfDay % 24) + 24) % 24;
		const utcRaw = h - this.#model.flight.lon / 15;
		const utcHour = ((utcRaw % 24) + 24) % 24;
		const now = new Date();
		this.#viewer.clock.currentTime = C.JulianDate.fromDate(
			new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
				Math.floor(utcHour), Math.floor((utcHour % 1) * 60))),
		);
	}

	/** Clock-synced atmosphere + clock-change trigger. */
	#syncClockCheck(): void {
		const m = this.#model;
		const a = this.#atmosphere;
		if (a.lastTimeOfDay !== m.timeOfDay || Math.abs(a.lastClockLon - m.flight.lon) > 0.5) {
			a.lastTimeOfDay = m.timeOfDay;
			a.lastClockLon = m.flight.lon;
			if (this.#viewer.scene.sun)
				this.#viewer.scene.sun.show = m.timeOfDay > T.DAWN_START && m.timeOfDay < T.DUSK_END;
			this.#syncClock();
		}
		this.#atmosphere.sync(
			{
				timeOfDay: m.timeOfDay, nightFactor: m.nightFactor, dawnDuskFactor: m.dawnDuskFactor,
				flight: { lon: m.flight.lon, camAlt: m.flight.camAlt },
				config: { world: m.config.world },
				sceneFog: m.sceneFog,
			},
			this.#viewer.clock.currentTime,
		);
	}

	// ── Render Loop ──────────────────────────────────────────────────────────

	#tick(): void {
		const now = performance.now();
		const dt = Math.min((now - this.#lastPostRenderTime) / 1000, 0.1);
		this.#lastPostRenderTime = now;
		const m = this.#model;

		this.#camera.sync({
			flight: m.flight,
			motion: m.motion,
			config: { camera: m.config.camera },
		});
		this.#syncClockCheck();
		this.#terrain.sync(m.terrainExaggeration);

		this.#imagery.sync({
			nightFactor: m.nightFactor, nightLightScale: m.nightLightScale,
			altitude: m.flight.altitude,
			config: { world: m.config.world },
		}, this.#getBootFade());

		this.#cloudBillboards.sync({
			lat: m.flight.lat, lon: m.flight.lon,
			weather: m.weather,
			density: m.config.atmosphere.clouds.density,
			altitudeFt: m.flight.altitude,
			enabled: m.config.world.useCesiumClouds,
		});

		this.#lightning.sync(dt, {
			hasLightning: m.config.atmosphere.weather.hasLightning,
			lightningDecayRate: m.config.atmosphere.weather.lightningDecayRate,
			lightningMinInterval: m.config.atmosphere.weather.lightningMinInterval,
			lightningMaxInterval: m.config.atmosphere.weather.lightningMaxInterval,
		});

		this.#buildings.sync(
			dt, m.nightFactor, m.nightLightScale, m.flight.altitude,
			m.config.world.buildingsEnabled, m.config.world.windowLightIntensity,
			this.#getBootFade(),
		);

		this.#colorGrade.sync(
			{ nightFactor: m.nightFactor, bootFade: this.#getBootFade() },
			{ additiveStrength: m.config.world.additiveStrength, qualityMode: m.config.world.qualityMode },
		);

		this.#syncQuality();
	}

	// ── Post-Process (bloom, AO, FXAA) ──────────────────────────────────────
	//
	// These aren't single subsystems (each is part of Cesium's post-process
	// graph and tied to the viewer), so they're inlined here as a
	// responsibility of the orchestrator. ColorGrade is its own manager.

	#setupPostProcess(): void {
		const v = this.#viewer;

		// HBAO — Pi-5 tuned: fewer directions/steps than desktop defaults.
		// Enabled per-tick in syncQuality when altitude < 15 000 ft.
		const ao = v.scene.postProcessStages.ambientOcclusion;
		if (ao) {
			ao.uniforms.intensity = 2.0;
			ao.uniforms.bias = 0.1;
			ao.uniforms.lengthCap = 0.26;
			ao.uniforms.directionCount = 4;
			ao.uniforms.stepCount = 16;
			ao.enabled = false;
		}

		// Bloom: enabled at non-performance quality modes so bright city-light
		// pixels bleed into soft halos that merge between adjacent intersections.
		const bloom = v.scene.postProcessStages?.bloom;
		if (bloom) {
			const allowBloom = this.#model.config.world.qualityMode !== 'performance';
			bloom.enabled = allowBloom;
			if (allowBloom) {
				const w = this.#model.config.world;
				bloom.uniforms.contrast = w.bloomContrast;
				bloom.uniforms.brightness = w.bloomBrightness;
				bloom.uniforms.sigma = w.bloomSigma;
				bloom.uniforms.delta = 1.0;
				bloom.uniforms.stepSize = 1.0;
				(bloom as unknown as { glowOnly?: boolean }).glowOnly = false;
			}
		}
	}

	#syncQuality(): void {
		const mode = this.#model.config.world.qualityMode;
		if (mode === this.#lastQualityMode) return;
		this.#lastQualityMode = mode;
		const allow = mode !== 'performance';
		const v = this.#viewer;
		const bloom = v.scene.postProcessStages?.bloom;
		if (bloom) bloom.enabled = allow;
		const ao = v.scene.postProcessStages.ambientOcclusion;
		if (ao) ao.enabled = allow;
		if (v.shadowMap) v.shadowMap.enabled = allow;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.postProcessStages as any).fxaa.enabled = allow;

		// Re-read bloom uniforms from config — previously only set at startup.
		if (bloom && allow) {
			const w = this.#model.config.world;
			bloom.uniforms.contrast = w.bloomContrast;
			bloom.uniforms.brightness = w.bloomBrightness;
			bloom.uniforms.sigma = w.bloomSigma;
		}
	}

	// ── Public API ───────────────────────────────────────────────────────────

	applyQualityMode(mode: QualityMode): void {
		const p = CESIUM_QUALITY_PRESETS[mode];
		const globe = this.#viewer.scene.globe;
		globe.maximumScreenSpaceError = p.maximumScreenSpaceError;
		globe.tileCacheSize = p.tileCacheSize;
		globe.preloadSiblings = p.preloadSiblings;
		globe.preloadAncestors = p.preloadAncestors;
		globe.loadingDescendantLimit = p.loadingDescendantLimit;
		this.#buildings.updateQuality(p.maximumScreenSpaceError);
	}

	setBuildingsWireframe(enabled: boolean): void { this.#buildings.setWireframe(enabled); }

	destroy(): void {
		this.#lightning.destroy();
		this.#cloudBillboards.destroy();
		this.#colorGrade.destroy();
		if (!this.#viewer.isDestroyed()) {
			if (this.#boundTick) this.#viewer.scene.postRender.removeEventListener(this.#boundTick);
			this.#viewer.destroy();
		}
	}
}
