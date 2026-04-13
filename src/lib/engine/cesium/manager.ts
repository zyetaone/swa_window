/**
 * CesiumManager — consolidated Cesium globe engine.
 *
 * Owns the Viewer lifecycle and orchestrates sub-systems.
 */

import type { QualityMode } from '$lib/shared/constants';
import type { LocationId, WeatherType } from '$lib/shared/types';
import type * as CesiumType from 'cesium';

// Decomposed systems
import { TerrainSystem } from './systems/TerrainSystem';
import { ImagerySystem } from './systems/ImagerySystem';
import { AtmosphereSystem } from './systems/AtmosphereSystem';
import { BuildingSystem } from './systems/BuildingSystem';
import { PostProcessSystem } from './systems/PostProcessSystem';

/**
 * Narrow interface — what CesiumManager reads from the model.
 * Updated to match the new structured WindowModel.
 */
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
}

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
	private terrain!: TerrainSystem;
	private imagery!: ImagerySystem;
	private atmosphere!: AtmosphereSystem;
	private buildings!: BuildingSystem;
	private postProcess!: PostProcessSystem;

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

		this.terrain = new TerrainSystem(v, C);
		this.imagery = new ImagerySystem(v, C);
		this.atmosphere = new AtmosphereSystem(v, C, m);
		this.buildings = new BuildingSystem(v, C, m);
		this.postProcess = new PostProcessSystem(v, C, m);
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

		const m = this.model;
		const f = m.flight;
		const mot = m.motion;

		if (!this.camInitialized) {
			this.camLat = f.lat;
			this.camLon = f.lon;
			this.camAlt = f.altitude;
			this.camHeading = f.heading;
			this.camPitch = f.pitch;
			this.camBank = mot.bankAngle;
			this.camInitialized = true;
		}

		const k = Math.min(1 - Math.exp(-dt / this.LERP_T), this.MAX_K);

		this.camLat += (f.lat - this.camLat) * k;
		this.camLon += (f.lon - this.camLon) * k;
		this.camAlt += (f.altitude - this.camAlt) * k;

		let dH = f.heading - this.camHeading;
		if (dH > 180) dH -= 360;
		if (dH < -180) dH += 360;
		this.camHeading += dH * k;
		this.camHeading = ((this.camHeading % 360) + 360) % 360;

		this.camPitch += (f.pitch - this.camPitch) * k;
		this.camBank += (mot.bankAngle - this.camBank) * k;

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
		this.imagery.sync(m);
		this.atmosphere.sync(m.timeOfDay);
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
