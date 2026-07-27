/**
 * ColorGradeManager — Cesium PostProcessStage for the night color-grade shader.
 *
 * Three responsibilities:
 *   1. Own the COLOR_GRADE_STAGE PostProcessStage (create, hold, dispose).
 *   2. Provide callback uniforms driven by bootFade + additiveStrength.
 *   3. Toggle stage.enabled per-frame:
 *      - off entirely in 'performance' quality mode (orchestrator controls)
 *      - off at nf < 0.001 (shader is verified identity passthrough; skip
 *        the fullscreen pass during the daytime half of every day)
 *
 * The day-off toggle was previously buried inside `syncImagery`; moved here
 * since it's a quality / cost decision, not an imagery-layer concern.
 */

import type * as CesiumType from 'cesium';
import { COLOR_GRADE_STAGE } from './shaders';
import { EpsilonGate } from './util';

type C = typeof CesiumType;

export interface ColorGradeConfig {
	readonly additiveStrength: number;
	readonly qualityMode: 'performance' | 'balanced' | 'ultra';
}

export interface ColorGradeSlice {
	readonly nightFactor: number;
	readonly bootFade: number;
}

export class ColorGradeManager {
	readonly #C: C;
	readonly #viewer: CesiumType.Viewer;
	readonly #glsl: string;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#stage: any = null;
	#enabledGate = new EpsilonGate<boolean>(0, false);

	constructor(Cesium: C, viewer: CesiumType.Viewer, fragmentShader: string) {
		this.#C = Cesium;
		this.#viewer = viewer;
		this.#glsl = fragmentShader;
	}

	setup(): void {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const existing = (this.#viewer.scene.postProcessStages as any).find?.(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(s: any) => s.name === COLOR_GRADE_STAGE,
			);
			if (existing) {
				this.#stage = existing as CesiumType.PostProcessStage;
				return;
			}
			const C = this.#C;
			this.#stage = new C.PostProcessStage({
				name: COLOR_GRADE_STAGE,
				fragmentShader: this.#glsl,
				uniforms: {
					// Cesium reads these via uniform callbacks each frame.
					// We pin them to a captured slice via the sync() interface
					// below — but PostProcessStage uniforms can only carry
					// functions, not captured state, so we close over the
					// model's #last slice field which is set right before
					// each tick.
					u_nightFactor: () => this.#lastNightFactor * this.#lastBootFade,
					u_additiveStrength: () => this.#lastAdditiveStrength,
				},
			});
			this.#viewer.scene.postProcessStages.add(this.#stage);
		} catch (e) {
			console.warn('[ColorGrade] Post-process failed:', e);
		}
	}

	// Cached for the uniform callbacks (they read at draw time, not sync time).
	#lastNightFactor = 0;
	#lastBootFade = 1;
	#lastAdditiveStrength = 1;

	sync(slice: ColorGradeSlice, config: ColorGradeConfig): void {
		this.#lastNightFactor = slice.nightFactor;
		this.#lastBootFade = slice.bootFade;
		this.#lastAdditiveStrength = config.additiveStrength;

		if (!this.#stage) return;

		// 'performance' mode: stage stays OFF. Cold path — gate only.
		if (config.qualityMode === 'performance') {
			this.#enabledGate.update(false, (v) => { this.#stage!.enabled = v; });
			return;
		}

		// Day-off: shader is identity at nf < 0.001 — skip the fullscreen pass.
		const shouldEnable = slice.nightFactor >= 0.001;
		this.#enabledGate.update(shouldEnable, (v) => { this.#stage!.enabled = v; });
	}

	destroy(): void {
		if (this.#stage) {
			this.#viewer.scene.postProcessStages.remove(this.#stage);
			this.#stage = null;
		}
	}
}
