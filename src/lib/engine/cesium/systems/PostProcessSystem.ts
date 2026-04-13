import type * as CesiumType from 'cesium';
import type { CesiumModelView } from '../manager';

export class PostProcessSystem {
	private readonly viewer: CesiumType.Viewer;
	private readonly C: typeof CesiumType;
	private readonly model: CesiumModelView;

	constructor(viewer: CesiumType.Viewer, C: typeof CesiumType, model: CesiumModelView) {
		this.viewer = viewer;
		this.C = C;
		this.model = model;
	}

	setup(COLOR_GRADING_GLSL: string): void {
		const v = this.viewer;
		const m = this.model;

		if (v.scene.postProcessStages?.bloom) {
			v.scene.postProcessStages.bloom.enabled = false;
		}

		try {
			const stage = new this.C.PostProcessStage({
				fragmentShader: COLOR_GRADING_GLSL,
				uniforms: {
					u_nightFactor: () => m.nightFactor,
					u_dawnDuskFactor: () => m.dawnDuskFactor,
					u_lightIntensity: () => m.nightLightScale,
				},
			});
			v.scene.postProcessStages.add(stage);
		} catch (e) {
			console.warn('[CesiumPostProcess] Color grading failed:', e);
		}
	}
}
