/**
 * CesiumManager — consolidated Cesium globe engine.
 *
 * Orchestrator: Viewer lifecycle, terrain, atmosphere, post-processing,
 * and the per-frame render loop. Imagery + buildings delegate to their
 * own modules (imagery.ts, buildings.ts).
 */

import type * as CesiumType from 'cesium';
import type { LocationId, WeatherType, QualityMode } from '$lib/types';
import { world } from '$lib/model/config-tree.svelte';
import { lerp, T } from '$lib/utils';
import { NIGHT_PALETTE } from '$content/compositions/night';
import { lightingState } from '$lib/world/curves';
import { LightningStage } from './lightning-stage';
import { CloudBillboardLayer } from './cloud-billboard-layer';
import { COLOR_GRADE_STAGE } from './shaders';
import {
	getIonToken,
	checkLocalTileServer,
	TILE_SERVER_URL,
	VIEWER_OPTIONS,
} from './cesium-setup';
import { CESIUM_QUALITY_PRESETS } from './model';
import { createImageryState, setupImagery, syncImagery } from './imagery';
import type { ImageryModel, ImageryState } from './imagery';
import { createBuildingsState, setupBuildings, syncBuildings, setBuildingsWireframe as applyBuildingsWireframe } from './buildings';
import type { BuildingsState } from './buildings';

type WorldConfig = typeof world;

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

	private lastPostRenderTime = performance.now();

	// State bags — buildings + imagery own their setup/sync logic downstream
	private imageryState: ImageryState;
	private buildingsState: BuildingsState;

	private lightningStage: LightningStage | null = null;
	private cloudBillboardLayer: CloudBillboardLayer | null = null;
	private colorGradeStage: CesiumType.PostProcessStage | null = null;
	private lastQualityMode: QualityMode | null = null;

	// Boot-time fade
	private bootStartMs: number | null = null;
	private static readonly BOOT_FADE_MS = 1600;
	private getBootFade(): number {
		if (this.bootStartMs === null) this.bootStartMs = performance.now();
		const t = (performance.now() - this.bootStartMs) / CesiumManager.BOOT_FADE_MS;
		return t >= 1 ? 1 : t < 0 ? 0 : t;
	}

	// Moonlight
	private moonlight: any = null;
	private originalSunLight: any = null;
	private isUsingMoonlight = false;
	private _sunPos: any = null;
	private _moonPos: any = null;
	private _earthToMoon: any = null;
	private _moonToSun: any = null;
	private _scratchDest: any = null;

	// Effect sync caches
	private lastGlobeColor = '';
	private lastFogDensity = -1;
	private lastFogBrightness = -1;
	private lastLightIntensity = -1;
	private lastSkySatShift = 999;
	private lastSkyBrShift = 999;
	private lastAtmoKilled: boolean | null = null;
	private lastExposure = -1;
	private lastAtmoLight = -1;
	private lastClockLon = -999;
	private lastTimeOfDay = -1;
	private started = false;
	private _moonPhaseTime = -1;
	private _moonPhaseCache = 1.0;
	private lastTerrainExaggeration = -1;
	private lastColorGradeEnabled: boolean | null = null;

	#boundTick: (() => void) | null = null;

	constructor(model: CesiumModelView, CesiumModule: typeof CesiumType, container: HTMLElement) {
		this.CesiumModule = CesiumModule;
		this.model = model;
		this.viewer = new CesiumModule.Viewer(container, VIEWER_OPTIONS);
		this.imageryState = createImageryState();
		this.buildingsState = createBuildingsState();
	}

	getViewer(): CesiumType.Viewer { return this.viewer; }
	getCesium(): typeof CesiumType { return this.CesiumModule; }

	async start(COLOR_GRADING_GLSL: string): Promise<void> {
		if (this.started) return;
		this.started = true;
		const C = this.CesiumModule;
		const v = this.viewer;

		v.scene.logarithmicDepthBuffer = true;
		v.scene.highDynamicRange = true;
		v.scene.postProcessStages.fxaa.enabled = true;
		v.scene.screenSpaceCameraController.enableInputs = false;
		(v.scene.postProcessStages as any).tonemapper = (C as any).Tonemapper.ACES;
		(v.scene.postProcessStages as any).exposure = 1.0;
		v.scene.globe.enableLighting = true;
		if (v.shadowMap) v.shadowMap.enabled = true;
		v.scene.requestRenderMode = false;
		v.scene.globe.oceanNormalMapUrl = C.buildModuleUrl('Assets/Textures/waterNormals.jpg');

		if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true;
		if (v.scene.skyBox) (v.scene.skyBox as any).show = true;
		if (v.scene.sun) { v.scene.sun.show = true; v.scene.sun.glowFactor = 2.0; }
		if (v.scene.moon) v.scene.moon.show = false;

		this.originalSunLight = v.scene.light;
		this.moonlight = new C.DirectionalLight({
			direction: new C.Cartesian3(0, 0, -1),
			color: new C.Color(0.95, 0.88, 0.78, 1.0),
			intensity: 0.0,
		});
		this._sunPos = new C.Cartesian3();
		this._moonPos = new C.Cartesian3();
		this._earthToMoon = new C.Cartesian3(0, 0, -1);
		this._moonToSun = new C.Cartesian3();
		this._scratchDest = new C.Cartesian3();

		this.#boundTick = this.tick.bind(this);
		v.scene.postRender.addEventListener(this.#boundTick);

		this.setupPostProcess(COLOR_GRADING_GLSL);
		await this.setupTerrain();
		await setupImagery(this.imageryState, C, v);
		await setupBuildings(this.buildingsState, C, v, this.model.config.world.buildingsEnabled);
		this.lightningStage = new LightningStage(C, v);
		this.lightningStage.mount();
		this.cloudBillboardLayer = new CloudBillboardLayer(C, v);
		this.cloudBillboardLayer.mount();

		this.tick();
		this.syncClock();
		v.resize();
		v.scene.requestRender();
	}

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
			const existing = (v.scene.postProcessStages as any).find?.((s: any) => s.name === COLOR_GRADE_STAGE);
			if (existing) {
				this.colorGradeStage = existing as CesiumType.PostProcessStage;
			} else {
				const stage = new this.CesiumModule.PostProcessStage({
					name: COLOR_GRADE_STAGE,
					fragmentShader: glsl,
					uniforms: {
						u_nightFactor: () => this.model.nightFactor * this.getBootFade(),
						u_additiveStrength: () => this.model.config.world.additiveStrength,
					},
				});
				v.scene.postProcessStages.add(stage);
				this.colorGradeStage = stage;
			}
		} catch (e) {
			console.warn('[CesiumManager] Post-process failed:', e);
		}
		this.syncQuality();
	}

	private syncQuality(): void {
		const mode = this.model.config.world.qualityMode;
		if (mode === this.lastQualityMode) {
			// Day-off color-grade toggle: disable at full day (nf < 0.001)
			// when shader is identity passthrough, skip the fullscreen pass.
			if (this.colorGradeStage && this.lastQualityMode !== 'performance') {
				const nf = this.model.nightFactor;
				const shouldEnable = nf >= 0.001;
				if (shouldEnable !== this.lastColorGradeEnabled) {
					this.colorGradeStage.enabled = shouldEnable;
					this.lastColorGradeEnabled = shouldEnable;
				}
			}
			return;
		}
		this.lastQualityMode = mode;
		const allow = mode !== 'performance';
		const bloom = this.viewer?.scene.postProcessStages?.bloom;
		if (bloom) bloom.enabled = allow;
		if (this.colorGradeStage) {
			this.colorGradeStage.enabled = allow;
			this.lastColorGradeEnabled = allow ? null : false;
		}

		const v = this.viewer;
		if (v.shadowMap) v.shadowMap.enabled = allow;
		(v.scene.postProcessStages as any).fxaa.enabled = allow;

		if (bloom && allow) {
			const w = this.model.config.world;
			bloom.uniforms.contrast = w.bloomContrast;
			bloom.uniforms.brightness = w.bloomBrightness;
			bloom.uniforms.sigma = w.bloomSigma;
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
		syncImagery(this.imageryState, this.model as unknown as ImageryModel, this.getBootFade());
		this.syncCloudBillboards();
		this.syncLightning(dt);
		syncBuildings(
			this.buildingsState, dt,
			this.model.nightFactor,
			this.model.nightLightScale,
			this.model.flight.altitude,
			this.model.config.world.buildingsEnabled,
			this.model.config.world.windowLightIntensity,
			() => this.getBootFade(),
			this.CesiumModule,
			this.viewer,
		);
		this.syncQuality();
	}

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
		const parallaxHeading = this.model.config.camera.effectiveHeading(f.camHeading);
		const SEAT_LOOK_DEG = 90;

		const C = this.CesiumModule;
		C.Cartesian3.fromDegrees(f.camLon, f.camLat, f.camAlt * 0.3048, undefined, this._scratchDest);
		const bankPitchCouple = this.model.config.camera.motion.bankPitchCouple ?? 0;
		const flyover = this.model.config.camera.flyoverPitchDeg ?? 0;
		const pitchDeg = flyover !== 0
			? flyover - bankPitchCouple * mot.bankAngle
			: (f.camPitch - 90) - bankPitchCouple * mot.bankAngle;
		this.viewer.camera.setView({
			destination: this._scratchDest,
			orientation: {
				heading: this.CesiumModule.Math.toRadians((parallaxHeading + SEAT_LOOK_DEG) % 360),
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
		const dd = lightingState(m.timeOfDay, nf).dawnDuskWeight;
		const isSunVisible = m.timeOfDay > T.DAWN_START && m.timeOfDay < T.DUSK_END;

		if (this.lastTimeOfDay !== m.timeOfDay || Math.abs(this.lastClockLon - m.flight.lon) > 0.5) {
			this.lastTimeOfDay = m.timeOfDay;
			this.lastClockLon = m.flight.lon;
			if (v.scene.sun) v.scene.sun.show = isSunVisible;
			this.syncClock();
		}

		if (v.scene.skyBox && (v.scene.skyBox as any).show !== true)
			(v.scene.skyBox as any).show = true;

		const G = NIGHT_PALETTE.globeColor;
		let r = lerp(lerp(G.day[0], G.night[0], nf), G.duskBias[0], dd * G.duskWeight);
		let g = lerp(lerp(G.day[1], G.night[1], nf), G.duskBias[1], dd * G.duskWeight);
		let b = lerp(lerp(G.day[2], G.night[2], nf), G.duskBias[2], dd * G.duskWeight);
		const colorKey = `${r},${g},${b}`;
		if (colorKey !== this.lastGlobeColor) {
			this.lastGlobeColor = colorKey;
			v.scene.globe.baseColor = C.Color.fromBytes(Math.round(r), Math.round(g), Math.round(b), 255);
		}

		const S = NIGHT_PALETTE.skyAtmosphere;
		const satShift = lerp(S.satShift.day, S.satShift.night, nf) + dd * S.satShift.duskBias;
		let brShift = (lerp(S.brShift.day, S.brShift.night, nf) * this.model.config.world.skyDarken)
			+ dd * S.brShift.duskBias;
		const ATMO_GATE_HI = 35000, ATMO_GATE_LO = 8000;
		const lowAltNight = nf * Math.max(0, Math.min(1,
			(ATMO_GATE_HI - m.flight.camAlt) / (ATMO_GATE_HI - ATMO_GATE_LO)));
		const deepNight = Math.max(0, Math.min(1, (nf - 0.7) / 0.3));
		brShift += (-1.0 - brShift) * deepNight * 0.6;
		brShift += (-1.0 - brShift) * lowAltNight;
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

		const killAtmo = deepNight > 0.6;
		if (killAtmo !== this.lastAtmoKilled) {
			this.lastAtmoKilled = killAtmo;
			if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = !killAtmo;
			(v.scene.globe as any).showGroundAtmosphere = !killAtmo;
		}

		const fog = m.sceneFog;
		const targetDensity = lerp(fog.dayDensity, fog.nightDensity, nf) * (1 + m.config.atmosphere.haze.amount * 8);
		const targetBrightness = lerp(fog.dayBrightness, fog.nightBrightness, nf);
		if (Math.abs(targetDensity - this.lastFogDensity) > 0.00001) {
			this.lastFogDensity = targetDensity;
			if (v.scene.fog) {
				v.scene.fog.enabled = targetDensity > 0.00001;
				v.scene.fog.density = targetDensity;
				(v.scene.fog as any).visualDensityScalar = 1.0 + 0.9 * nf + m.config.atmosphere.haze.amount * 4;
			}
		}
		if (Math.abs(targetBrightness - this.lastFogBrightness) > 0.01) {
			this.lastFogBrightness = targetBrightness;
			if (v.scene.fog) v.scene.fog.minimumBrightness = targetBrightness;
		}

		const w = this.model.config.world;
		const Cany = C as any;

		if (this._moonPhaseTime !== m.timeOfDay) {
			this._moonPhaseTime = m.timeOfDay;
			try {
				const julianDate = v.clock.currentTime;
				Cany.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(julianDate, this._sunPos);
				Cany.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(julianDate, this._moonPos);
				C.Cartesian3.normalize(this._moonPos, this._earthToMoon);
				C.Cartesian3.subtract(this._sunPos, this._moonPos, this._moonToSun);
				C.Cartesian3.normalize(this._moonToSun, this._moonToSun);
				const cosPhase = C.Cartesian3.dot(this._earthToMoon, this._moonToSun);
				this._moonPhaseCache = (1.0 - cosPhase) * 0.5;
			} catch {
				// keep last cached phase
			}
		}
		const moonPhase = this._moonPhaseCache;
		const phaseFactor = 0.7 + 0.3 * moonPhase;
		const moonlightIntensity = nf > 0.01 ? Math.max(w.moonlightIntensity * nf * phaseFactor, 0.035) : 0;

		if (nf > 0.85 && !this.isUsingMoonlight) {
			v.scene.light = this.moonlight;
			this.isUsingMoonlight = true;
		} else if (nf < 0.65 && this.isUsingMoonlight) {
			v.scene.light = this.originalSunLight;
			this.isUsingMoonlight = false;
		}

		if (this.isUsingMoonlight && this.moonlight) {
			this.moonlight.intensity = moonlightIntensity;
			C.Cartesian3.negate(this._earthToMoon, this.moonlight.direction);
		} else {
			const targetIntensity = lerp(1.0, 0.02, nf);
			if (Math.abs(targetIntensity - this.lastLightIntensity) > 0.01) {
				this.lastLightIntensity = targetIntensity;
				if (v.scene.light) v.scene.light.intensity = targetIntensity;
			}
		}

		const targetExposure
			= NIGHT_PALETTE.scene.exposureDay + (w.nightExposure - NIGHT_PALETTE.scene.exposureDay) * nf;
		if (Math.abs(targetExposure - this.lastExposure) > 0.005) {
			this.lastExposure = targetExposure;
			(v.scene.postProcessStages as any).exposure = targetExposure;
		}
		const targetAtmoLight
			= (NIGHT_PALETTE.scene.atmosphereLightDay
			+ (w.atmosphereLight - NIGHT_PALETTE.scene.atmosphereLightDay) * nf)
			* (1 - lowAltNight * 0.9)
			* (1 - deepNight * 0.55);
		if (Math.abs(targetAtmoLight - this.lastAtmoLight) > 0.005) {
			this.lastAtmoLight = targetAtmoLight;
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

	// ─── Terrain Setup ────────────────────────────────────────────────────────
	private async setupTerrain(): Promise<void> {
		const C = this.CesiumModule;
		const v = this.viewer;
		const useLocal = await checkLocalTileServer();
		if (useLocal) {
			try {
				v.terrainProvider = await C.CesiumTerrainProvider.fromUrl(`${TILE_SERVER_URL}/cesium-terrain`, { requestVertexNormals: true, requestWaterMask: true });
				return;
			} catch (e) { console.warn('[CesiumTerrain] Local failed, trying Ion:', e); }
		}
		if (getIonToken()) {
			try {
				v.terrainProvider = await C.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true });
				return;
			} catch (e) { console.warn('[CesiumTerrain] Ion failed, using ellipsoid:', e); }
		}
		console.warn('[CesiumTerrain] No local cache and no Ion token — using ellipsoid (flat)');
		v.terrainProvider = new C.EllipsoidTerrainProvider();
	}

	applyQualityMode(mode: QualityMode): void {
		const p = CESIUM_QUALITY_PRESETS[mode];
		const globe = this.viewer.scene.globe;
		globe.maximumScreenSpaceError = p.maximumScreenSpaceError;
		globe.tileCacheSize = p.tileCacheSize;
		globe.preloadSiblings = p.preloadSiblings;
		globe.preloadAncestors = p.preloadAncestors;
		globe.loadingDescendantLimit = p.loadingDescendantLimit;
		if (this.buildingsState.tileset) this.buildingsState.tileset.maximumScreenSpaceError = p.maximumScreenSpaceError;
	}

	setBuildingsWireframe(enabled: boolean): void {
		applyBuildingsWireframe(this.buildingsState, enabled);
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
