/**
 * CesiumManager — thin orchestrator for the Cesium globe.
 *
 * Delegates to reactive feature modules:
 *   imagery.ts    — base imagery, VIIRS, CartoDB roads
 *   buildings.ts  — OSM 3D Tiles + procedural shader
 *   atmosphere.ts — sky, fog, globe color, moonlight, exposure
 * Owns directly: viewer lifecycle, post-processing,
 * cloud billboards, lightning, and the per-frame render loop.
 * (Camera sync lives in ./camera — see syncCamera().)
 */

import type * as CesiumType from 'cesium';
import type { LocationId, WeatherType, QualityMode } from '$lib/types';
// Type-only: `world` is a live $state rune object, and compose.ts is a plain
// .ts module. A value import would put a runtime edge from the orchestrator to
// the reactive config module for no reason — the only use is `typeof world`
// below. `import type` erases entirely at build.
import type { world } from '$lib/model/config-tree.svelte';
import { T } from '$lib/utils';
import { syncCamera, type CameraSyncSlice } from './camera';
import { COLOR_GRADE_STAGE } from './shaders';
import { VIEWER_OPTIONS, applySceneDefaults, CESIUM_QUALITY_PRESETS } from './cesium-setup';
import { mountLightning, tickLightning, destroyLightning } from './lightning-stage';
import { mountCesiumClouds, updateCesiumClouds, destroyCesiumClouds } from './cloud-billboard-layer';
import { initImagery, setupImagery, syncImagery } from './imagery';
import { initBuildings, setupBuildings, syncBuildings, setBuildingsWireframe, updateBuildingsQuality } from './buildings';
import { installHashPalette } from './hash-palette';
import { initAtmosphere, syncAtmosphere } from './atmosphere';
import { initTerrain, setupTerrain, syncTerrain } from './terrain';
import { lightingState } from './curves';
import { SKY_PALETTE } from '$content/palettes';

type WorldConfig = typeof world;

// The camera-facing half of this view is DERIVED from CameraSyncSlice rather
// than re-typed. It was duplicated field-for-field, so adding a term to the
// camera sync (a new motion coupling, another pose field) meant editing the
// same shape in two files, and TypeScript would happily accept them drifting
// apart — compose would still compile while passing a slice the sync no longer
// fully describes.
interface CesiumModelView extends CameraSyncSlice {
	flight: CameraSyncSlice['flight'] & {
		lat: number; lon: number; altitude: number; heading: number; pitch: number;
		warpFactor: number;
	};
	config: CameraSyncSlice['config'] & {
		world: WorldConfig;
		atmosphere: {
			haze: { amount: number };
			clouds: { density: number; speed: number; layerCount: number };
			weather: {
				hasLightning: boolean; lightningDecayRate: number;
				lightningMinInterval: number; lightningMaxInterval: number;
				filterBrightness: number;
			};
		};
	};
	timeOfDay: number; nightFactor: number; dawnDuskFactor: number;
	nightLightScale: number; qualityMode: QualityMode;
	location: LocationId; weather: WeatherType;
	/** Needed for SKY_PALETTE.filterBrightness → Cesium exposure. */
	skyState: import('$lib/types').SkyState;
	sceneFog: { dayDensity: number; nightDensity: number; dayBrightness: number; nightBrightness: number };
	terrainExaggeration: number;
}

export class CesiumManager {
	readonly #C: typeof CesiumType;
	readonly #model: CesiumModelView;
	readonly #viewer: CesiumType.Viewer;

	// Lightning stage is module-level state in lightning-stage.ts (not tracked here).
	// Cesium clouds are module-level state in cloud-billboard-layer.ts (not tracked here).
	#colorGradeStage: CesiumType.PostProcessStage | null = null;
	#lastQualityMode: QualityMode | null = null;
	#lastColorGradeEnabled: boolean | null = null;

	// Clock-change gates — owned here; #syncClockCheck is their only consumer.
	#lastTimeOfDay = -1;
	#lastClockLon = -999;

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
	#scratchDest: CesiumType.Cartesian3 | null = null;
	constructor(model: CesiumModelView, CesiumModule: typeof CesiumType, container: HTMLElement) {

		this.#C = CesiumModule;
		this.#model = model;
		this.#viewer = new CesiumModule.Viewer(container, VIEWER_OPTIONS);
		initImagery(CesiumModule, this.#viewer);
		initBuildings(CesiumModule, this.#viewer);
		initAtmosphere(CesiumModule, this.#viewer);
		initTerrain(CesiumModule, this.#viewer);
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
		const C = this.#C;
		const v = this.#viewer;

		applySceneDefaults(v, C);
		initAtmosphere(C, v);
		this.#scratchDest = new C.Cartesian3();

		// Snap camera to flight position immediately so the first frame
		// shows terrain at the right altitude — not the default far-out globe.
		this.#syncCamera();

		this.#boundTick = this.#tick.bind(this);
		v.scene.postRender.addEventListener(this.#boundTick);

		this.#setupPostProcess(COLOR_GRADING_GLSL);
		if (this.#model.config.world.useHashPalette) {
			installHashPalette(C, v, () => this.#model.nightFactor, () => this.#model.nightLightScale, () => this.#model.config.world.darkVoidStrength, () => this.#model.config.world.envLight, () => this.#model.config.world.additiveStrength);
		}
		await setupTerrain();
		await setupImagery();
		await setupBuildings(
			this.#model.config.world.buildingsEnabled,
			this.#model.config.world.useDynamicEnvironmentMap,
		);

		mountLightning(C, v);
		mountCesiumClouds(C, v);

		this.#syncClock();
		this.#tick();
		// Apply the configured quality preset up front. The reactive effect in
		// CesiumViewer only fires when qualityMode CHANGES, so without this the
		// globe boots at Cesium's default maximumScreenSpaceError (=2) even
		// though qualityMode defaults to 'performance'.
		this.applyQualityMode(this.#model.config.world.qualityMode);
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
		syncTerrain(this.#model.terrainExaggeration);
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
		if (this.#lastTimeOfDay !== m.timeOfDay || Math.abs(this.#lastClockLon - m.flight.lon) > 0.5) {
			this.#lastTimeOfDay = m.timeOfDay;
			this.#lastClockLon = m.flight.lon;
			if (this.#viewer.scene.sun)
				this.#viewer.scene.sun.show = m.timeOfDay > T.DAWN_START && m.timeOfDay < T.DUSK_END;
			this.#syncClock();
		}
		const skyFb = SKY_PALETTE[m.skyState]?.filterBrightness ?? 1;
		const weatherFb = m.config.atmosphere.weather.filterBrightness ?? 1;
		syncAtmosphere(
			{
				timeOfDay: m.timeOfDay, nightFactor: m.nightFactor, dawnDuskFactor: m.dawnDuskFactor,
				flight: { lon: m.flight.lon, camAlt: m.flight.camAlt },
				config: { world: m.config.world },
				hazeAmount: m.config.atmosphere.haze.amount,
				sceneFog: m.sceneFog,
				// Was CSS filter on Pane — now multiplies Cesium exposure only.
				filterBrightness: skyFb * weatherFb,
				warpFactor: m.flight.warpFactor,
			},
			this.#viewer.clock.currentTime,
		);
	}

	// ── Delegated syncs ──────────────────────────────────────────────────────

	#syncImagery(): void {
		const m = this.#model;
		syncImagery(
			{
				nightFactor: m.nightFactor, nightLightScale: m.nightLightScale,
				altitude: m.flight.altitude,
				config: { world: m.config.world },
			},
			this.#getBootFade(),
		);
		if (this.#colorGradeStage && this.#lastQualityMode !== 'performance') {
			// Hash palette wins when enabled: the two grading stages must never
			// stack (double-grade), so color-grade stays off under useHashPalette.
			const should = m.nightFactor >= 0.001 && !m.config.world.useHashPalette;
			if (should !== this.#lastColorGradeEnabled) {
				this.#colorGradeStage.enabled = should;
				this.#lastColorGradeEnabled = should;
			}
		}
	}

	#syncBuildings(dt: number): void {
		const m = this.#model;
		// Same civil-twilight gate as wing nav lights (curves.ts cityLightAmount).
		const cityLightAmount = lightingState(m.timeOfDay, m.nightFactor).cityLightAmount;
		syncBuildings(
			dt, m.nightFactor, m.nightLightScale, m.flight.altitude,
			m.config.world.buildingsEnabled, m.config.world.windowLightIntensity,
			this.#getBootFade(),
			cityLightAmount,
		);
	}

	#syncCloudBillboards(): void {
		const m = this.#model;
		updateCesiumClouds(
			m.flight.lat, m.flight.lon, m.weather,
			m.config.atmosphere.clouds.density, m.flight.altitude,
			m.config.world.useCesiumClouds && m.config.world.showClouds && !m.config.world.useThreeOverlay,
		);
	}

	#syncLightning(dt: number): void {
		tickLightning(dt, {
			hasLightning: this.#model.config.atmosphere.weather.hasLightning,
			lightningDecayRate: this.#model.config.atmosphere.weather.lightningDecayRate,
			lightningMinInterval: this.#model.config.atmosphere.weather.lightningMinInterval,
			lightningMaxInterval: this.#model.config.atmosphere.weather.lightningMaxInterval,
		});
	}

	// ── Camera ───────────────────────────────────────────────────────────────

	/** Thin orchestrator wrapper — body lives in ./camera so the math is
	 * testable in isolation. The viewer + scratch buffer stay here because
	 * they belong to the Cesium instance. */
	#syncCamera(): void {
		if (!this.#scratchDest) return;
		syncCamera(
			{ flight: this.#model.flight, motion: this.#model.motion, config: this.#model.config },
			{ Cesium: this.#C, viewer: this.#viewer },
			this.#scratchDest,
		);
	}

	// ── Post-Process ─────────────────────────────────────────────────────────

	#setupPostProcess(glsl: string): void {
		const v = this.#viewer;
		// HBAO — Pi-5 tuned: fewer directions/steps than desktop defaults.
		// Enabled per-tick in atmosphere.ts when altitude < 15 000 ft
		// AND qualityMode !== "performance".
		const ao = v.scene.postProcessStages.ambientOcclusion;
		if (ao) {
			ao.uniforms.intensity = 2.0;
			ao.uniforms.bias = 0.1;
			ao.uniforms.lengthCap = 0.26;
			ao.uniforms.directionCount = 4;
			ao.uniforms.stepCount = 16;
			ao.enabled = false;
		}
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
		// Warm palette is load-bearing, but hash palette wins when enabled —
		// the two grading stages must never stack (double-grade).
		if (this.#colorGradeStage) this.#colorGradeStage.enabled = !this.#model.config.world.useHashPalette;
		const v = this.#viewer;
		if (v.shadowMap) v.shadowMap.enabled = allow;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.postProcessStages as any).fxaa.enabled = allow;
		const ao = v.scene.postProcessStages.ambientOcclusion;
		if (ao) ao.enabled = allow;
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
		updateBuildingsQuality(p.maximumScreenSpaceError);
	}

	setBuildingsWireframe(enabled: boolean): void { setBuildingsWireframe(enabled); }

	destroy(): void {
		destroyLightning();
		destroyCesiumClouds();
		if (!this.#viewer.isDestroyed()) {
			if (this.#boundTick) this.#viewer.scene.postRender.removeEventListener(this.#boundTick);
			this.#viewer.destroy();
		}
	}
}
