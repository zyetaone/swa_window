/**
 * CesiumManager — thin orchestrator for the Cesium globe.
 *
 * Delegates to:
 *   ImageryManager      — base imagery, VIIRS, CartoDB roads
 *   BuildingsManager    — OSM 3D Tiles + procedural shader
 *   AtmosphereManager   — sky, fog, globe color, moonlight, exposure
 *   TerrainManager      — terrain provider + exaggeration
 *
 * Owns directly: viewer lifecycle, camera sync, post-processing,
 * cloud billboards, lightning, and the per-frame render loop.
 */

import type * as CesiumType from 'cesium';
import type { LocationId, WeatherType, QualityMode } from '$lib/types';
import { world } from '$lib/model/config-tree.svelte';
import { T } from '$lib/utils';
import { COLOR_GRADE_STAGE } from './shaders';
import { VIEWER_OPTIONS, applySceneDefaults } from './cesium-setup';
import { CESIUM_QUALITY_PRESETS } from './model';
import { LightningStage } from './lightning-stage';
import { CloudBillboardLayer } from './cloud-billboard-layer';
import { ImageryManager } from './imagery';
import { BuildingsManager } from './buildings';
import { AtmosphereManager } from './atmosphere-manager';
import { TerrainManager } from './terrain-manager';

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

	readonly #imagery: ImageryManager;
	readonly #buildings: BuildingsManager;
	readonly #atmosphere: AtmosphereManager;
	readonly #terrain: TerrainManager;

	#lightning: LightningStage | null = null;
	#cloudBillboards: CloudBillboardLayer | null = null;
	#colorGradeStage: CesiumType.PostProcessStage | null = null;
	#lastQualityMode: QualityMode | null = null;
	#lastColorGradeEnabled: boolean | null = null;

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

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#scratchDest: any = null;

	constructor(model: CesiumModelView, CesiumModule: typeof CesiumType, container: HTMLElement) {
		this.#C = CesiumModule;
		this.#model = model;
		this.#viewer = new CesiumModule.Viewer(container, VIEWER_OPTIONS);
		this.#imagery = new ImageryManager(CesiumModule, this.#viewer);
		this.#buildings = new BuildingsManager(CesiumModule, this.#viewer);
		this.#atmosphere = new AtmosphereManager(CesiumModule, this.#viewer);
		this.#terrain = new TerrainManager(CesiumModule, this.#viewer);
	}

	getViewer(): CesiumType.Viewer { return this.#viewer; }
	getCesium(): typeof CesiumType { return this.#C; }

	// ── Start ────────────────────────────────────────────────────────────────

	async start(COLOR_GRADING_GLSL: string): Promise<void> {
		if (this.#started) return;
		this.#started = true;
		const C = this.#C;
		const v = this.#viewer;

		applySceneDefaults(v, C);
		this.#atmosphere.init(C, v);
		this.#scratchDest = new C.Cartesian3();

		this.#boundTick = this.#tick.bind(this);
		v.scene.postRender.addEventListener(this.#boundTick);

		this.#setupPostProcess(COLOR_GRADING_GLSL);
		await this.#terrain.setup();
		await this.#imagery.setup();
		await this.#buildings.setup(this.#model.config.world.buildingsEnabled);

		this.#lightning = new LightningStage(C, v);
		this.#lightning.mount();
		this.#cloudBillboards = new CloudBillboardLayer(C, v);
		this.#cloudBillboards.mount();

		this.#syncClock();
		this.#tick();
		v.resize();
		v.scene.requestRender();
	}

	// ── Render Loop ──────────────────────────────────────────────────────────

	#tick(): void {
		const now = performance.now();
		const dt = Math.min((now - this.#lastPostRenderTime) / 1000, 0.1);
		this.#lastPostRenderTime = now;

		this.#syncCamera();
		this.#syncClockCheck();
		this.#terrain.sync(this.#model.terrainExaggeration);
		this.#syncImagery();
		this.#syncCloudBillboards();
		this.#syncLightning(dt);
		this.#syncBuildings(dt);
		this.#syncQuality();
	}

	// ── Clock ────────────────────────────────────────────────────────────────

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

	/** Sync clock when timeOfDay or longitude changed. Then sync atmosphere. */
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

	// ── Delegated syncs ──────────────────────────────────────────────────────

	#syncImagery(): void {
		const m = this.#model;
		this.#imagery.sync(
			{
				nightFactor: m.nightFactor, nightLightScale: m.nightLightScale,
				altitude: m.flight.altitude,
				config: { world: m.config.world },
			},
			this.#getBootFade(),
		);
		if (this.#colorGradeStage && this.#lastQualityMode !== 'performance') {
			const should = m.nightFactor >= 0.001;
			if (should !== this.#lastColorGradeEnabled) {
				this.#colorGradeStage.enabled = should;
				this.#lastColorGradeEnabled = should;
			}
		}
	}

	#syncBuildings(dt: number): void {
		const m = this.#model;
		this.#buildings.sync(
			dt, m.nightFactor, m.nightLightScale, m.flight.altitude,
			m.config.world.buildingsEnabled, m.config.world.windowLightIntensity,
			this.#getBootFade(),
		);
	}

	#syncCloudBillboards(): void {
		if (!this.#cloudBillboards) return;
		const m = this.#model;
		this.#cloudBillboards.update(
			m.flight.lat, m.flight.lon, m.weather,
			m.config.atmosphere.clouds.density, m.flight.altitude,
			m.config.world.useCesiumClouds,
		);
	}

	#syncLightning(dt: number): void {
		if (!this.#lightning) return;
		this.#lightning.tick(dt,
			this.#model.config.atmosphere.weather.hasLightning,
			this.#model.config.atmosphere.weather.lightningDecayRate,
			this.#model.config.atmosphere.weather.lightningMinInterval,
			this.#model.config.atmosphere.weather.lightningMaxInterval,
		);
	}

	// ── Camera ───────────────────────────────────────────────────────────────

	#syncCamera(): void {
		const f = this.#model.flight;
		const parallaxHeading = this.#model.config.camera.effectiveHeading(f.camHeading);
		const C = this.#C;
		C.Cartesian3.fromDegrees(f.camLon, f.camLat, f.camAlt * 0.3048, undefined, this.#scratchDest);

		const bankPitchCouple = this.#model.config.camera.motion.bankPitchCouple ?? 0;
		const flyover = this.#model.config.camera.flyoverPitchDeg ?? 0;
		const pitchDeg = flyover !== 0
			? flyover - bankPitchCouple * this.#model.motion.bankAngle
			: (f.camPitch - 90) - bankPitchCouple * this.#model.motion.bankAngle;

		this.#viewer.camera.setView({
			destination: this.#scratchDest,
			orientation: {
				heading: C.Math.toRadians((parallaxHeading + 90) % 360),
				pitch: C.Math.toRadians(pitchDeg),
				roll: C.Math.toRadians(-this.#model.motion.bankAngle),
			},
		});
	}

	// ── Post-Process ─────────────────────────────────────────────────────────

	#setupPostProcess(glsl: string): void {
		const v = this.#viewer;
		const bloom = v.scene.postProcessStages?.bloom;
		if (bloom) {
			const allow = this.#model.config.world.qualityMode !== 'performance';
			bloom.enabled = allow;
			if (allow) {
				const w = this.#model.config.world;
				bloom.uniforms.contrast = w.bloomContrast;
				bloom.uniforms.brightness = w.bloomBrightness;
				bloom.uniforms.sigma = w.bloomSigma;
				bloom.uniforms.delta = 1.0;
				bloom.uniforms.stepSize = 1.0;
				(bloom as unknown as { glowOnly?: boolean }).glowOnly = false;
			}
		}
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const existing = (v.scene.postProcessStages as any).find?.((s: { name: string }) => s.name === COLOR_GRADE_STAGE);
			this.#colorGradeStage = existing ? existing as CesiumType.PostProcessStage : null;
			if (!this.#colorGradeStage) {
				const stage = new this.#C.PostProcessStage({
					name: COLOR_GRADE_STAGE, fragmentShader: glsl,
					uniforms: {
						u_nightFactor: () => this.#model.nightFactor * this.#getBootFade(),
						u_additiveStrength: () => this.#model.config.world.additiveStrength,
					},
				});
				v.scene.postProcessStages.add(stage);
				this.#colorGradeStage = stage as CesiumType.PostProcessStage;
			}
		} catch (e) { console.warn('[Cesium] Post-process failed:', e); }
		this.#syncQuality();
	}

	#syncQuality(): void {
		const mode = this.#model.config.world.qualityMode;
		if (mode === this.#lastQualityMode) return;
		this.#lastQualityMode = mode;
		const allow = mode !== 'performance';
		const bloom = this.#viewer?.scene.postProcessStages?.bloom;
		if (bloom) bloom.enabled = allow;
		if (this.#colorGradeStage) this.#colorGradeStage.enabled = allow;
		const v = this.#viewer;
		if (v.shadowMap) v.shadowMap.enabled = allow;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.postProcessStages as any).fxaa.enabled = allow;
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
		if (this.#lightning) { this.#lightning.destroy(); this.#lightning = null; }
		if (this.#cloudBillboards) { this.#cloudBillboards.destroy(); this.#cloudBillboards = null; }
		if (!this.#viewer.isDestroyed()) {
			if (this.#boundTick) this.#viewer.scene.postRender.removeEventListener(this.#boundTick);
			this.#viewer.destroy();
		}
	}
}
