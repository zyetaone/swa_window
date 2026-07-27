/**
 * CesiumManager — orchestrator for the Cesium globe.
 *
 * Delegates to sub-managers:
 *   ImageryManager  — base imagery, VIIRS, CartoDB roads
 *   BuildingsManager — OSM 3D Tiles + procedural shader
 *
 * Owns directly: viewer lifecycle, terrain, atmosphere, post-processing,
 * camera sync, and the per-frame render loop.
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
import { ImageryManager } from './imagery';
import { BuildingsManager } from './buildings';

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
				hasLightning: boolean;
				lightningDecayRate: number; lightningMinInterval: number; lightningMaxInterval: number;
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

	// ── Sub-managers ─────────────────────────────────────────────────────────
	readonly #imagery: ImageryManager;
	readonly #buildings: BuildingsManager;

	// ── Auxiliary layers ─────────────────────────────────────────────────────
	#lightning: LightningStage | null = null;
	#cloudBillboards: CloudBillboardLayer | null = null;
	#colorGradeStage: CesiumType.PostProcessStage | null = null;
	#lastQualityMode: QualityMode | null = null;

	// ── Tick state ───────────────────────────────────────────────────────────
	#lastPostRenderTime = performance.now();
	#boundTick: (() => void) | null = null;
	#started = false;

	// ── Boot fade ────────────────────────────────────────────────────────────
	#bootStartMs: number | null = null;
	static readonly BOOT_FADE_MS = 1600;
	#getBootFade(): number {
		if (this.#bootStartMs === null) this.#bootStartMs = performance.now();
		const t = (performance.now() - this.#bootStartMs) / CesiumManager.BOOT_FADE_MS;
		return t >= 1 ? 1 : t < 0 ? 0 : t;
	}

	// ── Camera sync ──────────────────────────────────────────────────────────
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#scratchDest: any = null;

	// ── Atmosphere state ─────────────────────────────────────────────────────
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#moonlight: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#originalSunLight: any = null;
	#isUsingMoonlight = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#sunPos: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#moonPos: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#earthToMoon: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#moonToSun: any = null;

	#lastGlobeColor = '';
	#lastFogDensity = -1;
	#lastFogBrightness = -1;
	#lastLightIntensity = -1;
	#lastSkySatShift = 999;
	#lastSkyBrShift = 999;
	#lastAtmoKilled: boolean | null = null;
	#lastExposure = -1;
	#lastAtmoLight = -1;
	#lastClockLon = -999;
	#lastTimeOfDay = -1;
	#moonPhaseTime = -1;
	#moonPhaseCache = 1.0;
	#lastTerrainExaggeration = -1;
	#lastColorGradeEnabled: boolean | null = null;

	// ── Constructor ──────────────────────────────────────────────────────────

	constructor(model: CesiumModelView, CesiumModule: typeof CesiumType, container: HTMLElement) {
		this.#C = CesiumModule;
		this.#model = model;
		this.#viewer = new CesiumModule.Viewer(container, VIEWER_OPTIONS);
		this.#imagery = new ImageryManager(CesiumModule, this.#viewer);
		this.#buildings = new BuildingsManager(CesiumModule, this.#viewer);
	}

	getViewer(): CesiumType.Viewer { return this.#viewer; }
	getCesium(): typeof CesiumType { return this.#C; }

	// ── Start ────────────────────────────────────────────────────────────────

	async start(COLOR_GRADING_GLSL: string): Promise<void> {
		if (this.#started) return;
		this.#started = true;
		const C = this.#C;
		const v = this.#viewer;

		v.scene.logarithmicDepthBuffer = true;
		v.scene.highDynamicRange = true;
		v.scene.postProcessStages.fxaa.enabled = true;
		v.scene.screenSpaceCameraController.enableInputs = false;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.postProcessStages as any).tonemapper = (C as any).Tonemapper.ACES;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(v.scene.postProcessStages as any).exposure = 1.0;
		v.scene.globe.enableLighting = true;
		if (v.shadowMap) v.shadowMap.enabled = true;
		v.scene.requestRenderMode = false;
		v.scene.globe.oceanNormalMapUrl = C.buildModuleUrl('Assets/Textures/waterNormals.jpg');

		if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true;
		if (v.scene.skyBox) (v.scene.skyBox as { show: boolean }).show = true;
		if (v.scene.sun) { v.scene.sun.show = true; v.scene.sun.glowFactor = 2.0; }
		if (v.scene.moon) v.scene.moon.show = false;

		this.#originalSunLight = v.scene.light;
		this.#moonlight = new C.DirectionalLight({
			direction: new C.Cartesian3(0, 0, -1),
			color: new C.Color(0.95, 0.88, 0.78, 1.0),
			intensity: 0.0,
		});
		this.#sunPos = new C.Cartesian3();
		this.#moonPos = new C.Cartesian3();
		this.#earthToMoon = new C.Cartesian3(0, 0, -1);
		this.#moonToSun = new C.Cartesian3();
		this.#scratchDest = new C.Cartesian3();

		this.#boundTick = this.#tick.bind(this);
		v.scene.postRender.addEventListener(this.#boundTick);

		this.#setupPostProcess(COLOR_GRADING_GLSL);
		await this.#setupTerrain();
		await this.#imagery.setup();
		await this.#buildings.setup(this.#model.config.world.buildingsEnabled);

		this.#lightning = new LightningStage(C, v);
		this.#lightning.mount();
		this.#cloudBillboards = new CloudBillboardLayer(C, v);
		this.#cloudBillboards.mount();

		this.#tick();
		this.#syncClock();
		v.resize();
		v.scene.requestRender();
	}

	// ── Render Loop ──────────────────────────────────────────────────────────

	#tick(): void {
		const now = performance.now();
		const dt = Math.min((now - this.#lastPostRenderTime) / 1000, 0.1);
		this.#lastPostRenderTime = now;

		this.#syncCamera();
		this.#syncAtmosphere();
		this.#syncTerrainExaggeration();
		this.#syncImagery();
		this.#syncCloudBillboards();
		this.#syncLightning(dt);
		this.#syncBuildings(dt);
		this.#syncQuality();
	}

	// ── Delegated syncs ──────────────────────────────────────────────────────

	#syncImagery(): void {
		const m = this.#model;
		this.#imagery.sync(
			{
				nightFactor: m.nightFactor,
				nightLightScale: m.nightLightScale,
				altitude: m.flight.altitude,
				config: { world: m.config.world },
			},
			this.#getBootFade(),
		);
		// Color-grade toggle — disable at full day when shader is identity.
		if (this.#colorGradeStage && this.#lastQualityMode !== 'performance') {
			const nf = m.nightFactor;
			const shouldEnable = nf >= 0.001;
			if (shouldEnable !== this.#lastColorGradeEnabled) {
				this.#colorGradeStage.enabled = shouldEnable;
				this.#lastColorGradeEnabled = shouldEnable;
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
			m.config.atmosphere.clouds.density,
			m.flight.altitude,
			m.config.world.useCesiumClouds,
		);
	}

	#syncLightning(dt: number): void {
		if (!this.#lightning) return;
		const w = this.#model.config.atmosphere.weather;
		this.#lightning.tick(dt, w.hasLightning, w.lightningDecayRate, w.lightningMinInterval, w.lightningMaxInterval);
	}

	// ── Camera ───────────────────────────────────────────────────────────────

	#syncCamera(): void {
		const f = this.#model.flight;
		const parallaxHeading = this.#model.config.camera.effectiveHeading(f.camHeading);
		const SEAT_LOOK_DEG = 90;
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
				heading: C.Math.toRadians((parallaxHeading + SEAT_LOOK_DEG) % 360),
				pitch: C.Math.toRadians(pitchDeg),
				roll: C.Math.toRadians(-this.#model.motion.bankAngle),
			},
		});
	}

	// ── Clock ────────────────────────────────────────────────────────────────

	#syncClock(): void {
		const C = this.#C;
		const localHour = ((this.#model.timeOfDay % 24) + 24) % 24;
		const lon = this.#model.flight.lon;
		const utcRaw = localHour - lon / 15;
		const utcHour = ((utcRaw % 24) + 24) % 24;
		const hours = Math.floor(utcHour);
		const minutes = Math.floor((utcHour % 1) * 60);
		const now = new Date();
		this.#viewer.clock.currentTime = C.JulianDate.fromDate(
			new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes)),
		);
	}

	// ── Post Process ─────────────────────────────────────────────────────────

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
			if (existing) {
				this.#colorGradeStage = existing as CesiumType.PostProcessStage;
			} else {
				const stage = new this.#C.PostProcessStage({
					name: COLOR_GRADE_STAGE,
					fragmentShader: glsl,
					uniforms: {
						u_nightFactor: () => this.#model.nightFactor * this.#getBootFade(),
						u_additiveStrength: () => this.#model.config.world.additiveStrength,
					},
				});
				v.scene.postProcessStages.add(stage);
				this.#colorGradeStage = stage;
			}
		} catch (e) {
			console.warn('[Cesium] Post-process failed:', e);
		}
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

	// ── Terrain ──────────────────────────────────────────────────────────────

	async #setupTerrain(): Promise<void> {
		const C = this.#C;
		const v = this.#viewer;
		if (await checkLocalTileServer()) {
			try {
				v.terrainProvider = await C.CesiumTerrainProvider.fromUrl(
					`${TILE_SERVER_URL}/cesium-terrain`,
					{ requestVertexNormals: true, requestWaterMask: true },
				);
				return;
			} catch (e) { console.warn('[Terrain] Local failed, trying Ion:', e); }
		}
		if (getIonToken()) {
			try {
				v.terrainProvider = await C.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true });
				return;
			} catch (e) { console.warn('[Terrain] Ion failed, using ellipsoid:', e); }
		}
		console.warn('[Terrain] No cache/token — flat ellipsoid');
		v.terrainProvider = new C.EllipsoidTerrainProvider();
	}

	#syncTerrainExaggeration(): void {
		const te = this.#model.terrainExaggeration;
		if (Math.abs(te - this.#lastTerrainExaggeration) > 0.01) {
			this.#lastTerrainExaggeration = te;
			this.#viewer.scene.verticalExaggeration = te;
		}
	}

	// ── Atmosphere ───────────────────────────────────────────────────────────

	#syncAtmosphere(): void {
		const m = this.#model;
		const v = this.#viewer;
		const C = this.#C;
		const nf = m.nightFactor;
		const dd = lightingState(m.timeOfDay, nf).dawnDuskWeight;

		if (this.#lastTimeOfDay !== m.timeOfDay || Math.abs(this.#lastClockLon - m.flight.lon) > 0.5) {
			this.#lastTimeOfDay = m.timeOfDay;
			this.#lastClockLon = m.flight.lon;
			if (v.scene.sun) v.scene.sun.show = m.timeOfDay > T.DAWN_START && m.timeOfDay < T.DUSK_END;
			this.#syncClock();
		}

		// Globe color
		const G = NIGHT_PALETTE.globeColor;
		const r = lerp(lerp(G.day[0], G.night[0], nf), G.duskBias[0], dd * G.duskWeight);
		const g = lerp(lerp(G.day[1], G.night[1], nf), G.duskBias[1], dd * G.duskWeight);
		const b = lerp(lerp(G.day[2], G.night[2], nf), G.duskBias[2], dd * G.duskWeight);
		const colorKey = `${r},${g},${b}`;
		if (colorKey !== this.#lastGlobeColor) {
			this.#lastGlobeColor = colorKey;
			v.scene.globe.baseColor = C.Color.fromBytes(Math.round(r), Math.round(g), Math.round(b), 255);
		}

		// Sky atmosphere
		const S = NIGHT_PALETTE.skyAtmosphere;
		const satShift = lerp(S.satShift.day, S.satShift.night, nf) + dd * S.satShift.duskBias;
		let brShift = lerp(S.brShift.day, S.brShift.night, nf) * this.#model.config.world.skyDarken + dd * S.brShift.duskBias;

		const ATMO_GATE_HI = 35000, ATMO_GATE_LO = 8000;
		const lowAltNight = nf * Math.max(0, Math.min(1, (ATMO_GATE_HI - m.flight.camAlt) / (ATMO_GATE_HI - ATMO_GATE_LO)));
		const deepNight = Math.max(0, Math.min(1, (nf - 0.7) / 0.3));
		brShift += (-1.0 - brShift) * deepNight * 0.6;
		brShift += (-1.0 - brShift) * lowAltNight;

		if ((Math.abs(satShift - this.#lastSkySatShift) > 0.01 || Math.abs(brShift - this.#lastSkyBrShift) > 0.01) && v.scene.skyAtmosphere) {
			if (Math.abs(satShift - this.#lastSkySatShift) > 0.01) { v.scene.skyAtmosphere.saturationShift = satShift; this.#lastSkySatShift = satShift; }
			if (Math.abs(brShift - this.#lastSkyBrShift) > 0.01) { v.scene.skyAtmosphere.brightnessShift = brShift; this.#lastSkyBrShift = brShift; }
		}

		const killAtmo = deepNight > 0.6;
		if (killAtmo !== this.#lastAtmoKilled) {
			this.#lastAtmoKilled = killAtmo;
			if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = !killAtmo;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v.scene.globe as any).showGroundAtmosphere = !killAtmo;
		}

		// Fog
		const fog = m.sceneFog;
		const targetDensity = lerp(fog.dayDensity, fog.nightDensity, nf) * (1 + m.config.atmosphere.haze.amount * 8);
		const targetBrightness = lerp(fog.dayBrightness, fog.nightBrightness, nf);
		if (Math.abs(targetDensity - this.#lastFogDensity) > 0.00001) {
			this.#lastFogDensity = targetDensity;
			if (v.scene.fog) {
				v.scene.fog.enabled = targetDensity > 0.00001;
				v.scene.fog.density = targetDensity;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(v.scene.fog as any).visualDensityScalar = 1.0 + 0.9 * nf + m.config.atmosphere.haze.amount * 4;
			}
		}
		if (Math.abs(targetBrightness - this.#lastFogBrightness) > 0.01) {
			this.#lastFogBrightness = targetBrightness;
			if (v.scene.fog) v.scene.fog.minimumBrightness = targetBrightness;
		}

		// Moonlight
		const w = this.#model.config.world;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const Cany = C as any;

		if (this.#moonPhaseTime !== m.timeOfDay) {
			this.#moonPhaseTime = m.timeOfDay;
			try {
				const julianDate = v.clock.currentTime;
				Cany.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(julianDate, this.#sunPos);
				Cany.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(julianDate, this.#moonPos);
				C.Cartesian3.normalize(this.#moonPos, this.#earthToMoon);
				C.Cartesian3.subtract(this.#sunPos, this.#moonPos, this.#moonToSun);
				C.Cartesian3.normalize(this.#moonToSun, this.#moonToSun);
				this.#moonPhaseCache = (1.0 - C.Cartesian3.dot(this.#earthToMoon, this.#moonToSun)) * 0.5;
			} catch { /* keep last cached phase */ }
		}

		const phaseFactor = 0.7 + 0.3 * this.#moonPhaseCache;
		const moonlightIntensity = nf > 0.01 ? Math.max(w.moonlightIntensity * nf * phaseFactor, 0.035) : 0;

		if (nf > 0.85 && !this.#isUsingMoonlight) { v.scene.light = this.#moonlight; this.#isUsingMoonlight = true; }
		else if (nf < 0.65 && this.#isUsingMoonlight) { v.scene.light = this.#originalSunLight; this.#isUsingMoonlight = false; }

		if (this.#isUsingMoonlight && this.#moonlight) {
			this.#moonlight.intensity = moonlightIntensity;
			C.Cartesian3.negate(this.#earthToMoon, this.#moonlight.direction);
		} else {
			const targetIntensity = lerp(1.0, 0.02, nf);
			if (Math.abs(targetIntensity - this.#lastLightIntensity) > 0.01) {
				this.#lastLightIntensity = targetIntensity;
				if (v.scene.light) v.scene.light.intensity = targetIntensity;
			}
		}

		// Exposure + atmosphere light
		const targetExposure = NIGHT_PALETTE.scene.exposureDay + (w.nightExposure - NIGHT_PALETTE.scene.exposureDay) * nf;
		if (Math.abs(targetExposure - this.#lastExposure) > 0.005) {
			this.#lastExposure = targetExposure;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v.scene.postProcessStages as any).exposure = targetExposure;
		}
		const targetAtmoLight = (NIGHT_PALETTE.scene.atmosphereLightDay + (w.atmosphereLight - NIGHT_PALETTE.scene.atmosphereLightDay) * nf)
			* (1 - lowAltNight * 0.9) * (1 - deepNight * 0.55);
		if (Math.abs(targetAtmoLight - this.#lastAtmoLight) > 0.005) {
			this.#lastAtmoLight = targetAtmoLight;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v.scene.globe as any).atmosphereLightIntensity = targetAtmoLight;
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

	setBuildingsWireframe(enabled: boolean): void {
		this.#buildings.setWireframe(enabled);
	}

	destroy(): void {
		if (this.#lightning) { this.#lightning.destroy(); this.#lightning = null; }
		if (this.#cloudBillboards) { this.#cloudBillboards.destroy(); this.#cloudBillboards = null; }
		if (!this.#viewer.isDestroyed()) {
			if (this.#boundTick) this.#viewer.scene.postRender.removeEventListener(this.#boundTick);
			this.#viewer.destroy();
		}
	}
}
