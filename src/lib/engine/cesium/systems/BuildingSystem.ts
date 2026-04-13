import type * as CesiumType from 'cesium';
import { CESIUM_QUALITY_PRESETS } from '$lib/shared/constants';
import { lerp } from '$lib/shared/utils';
import type { CesiumModelView } from '../manager';
import type { QualityMode } from '$lib/shared/constants';
import { getIonToken } from '../config';

export class BuildingSystem {
	private readonly viewer: CesiumType.Viewer;
	private readonly C: typeof CesiumType;
	private readonly model: CesiumModelView;

	private tileset: CesiumType.Cesium3DTileset | null = null;
	private lastNightFactor = -1;

	constructor(viewer: CesiumType.Viewer, C: typeof CesiumType, model: CesiumModelView) {
		this.viewer = viewer;
		this.C = C;
		this.model = model;
	}

	async setup(qualityMode: QualityMode = 'balanced'): Promise<void> {
		if (!this.C) return;
		if (!getIonToken()) {
			console.warn('[CesiumBuildings] Ion token missing — buildings disabled');
			return;
		}
		try {
			this.tileset = await this.C.createOsmBuildingsAsync();
			if (this.tileset) {
				this.tileset.show = this.model.showBuildings;
				this.applyQualityMode(qualityMode);
				this.viewer.scene.primitives.add(this.tileset);
			}
		} catch (err) {
			console.warn('[CesiumBuildings] OSM buildings unavailable:', (err as Error).message ?? err);
		}
	}

	applyQualityMode(mode: QualityMode): void {
		if (!this.tileset) return;
		const p = CESIUM_QUALITY_PRESETS[mode];
		this.tileset.maximumScreenSpaceError = p.maximumScreenSpaceError;
	}

	sync(): void {
		if (this.tileset) this.tileset.show = this.model.showBuildings;
	}

	syncNightFactor(): void {
		const nf = this.model.nightFactor;
		if (Math.abs(nf - this.lastNightFactor) < 0.01) return;
		this.lastNightFactor = nf;
		this.applyNightStyle(nf);
	}

	private applyNightStyle(nf: number): void {
		const t = this.tileset;
		if (!t) return;
		const r = Math.round(lerp(240, 80, nf));
		const g = Math.round(lerp(220, 75, nf));
		const b = Math.round(lerp(200, 60, nf));
		t.style = new this.C.Cesium3DTileStyle({
			color: `rgba(${r}, ${g}, ${b}, 0.9)`,
		});
	}
}
