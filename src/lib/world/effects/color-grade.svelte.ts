/**
 * color-grade — Cesium PostProcessStage for night color grading.
 *
 * Reactive feature with one imperative mount. The PostProcessStage is
 * created once at mount() with shader-driven uniforms; the per-frame
 * \$effect syncs nightFactor and additiveStrength into those uniforms
 * and toggles `enabled` based on nightFactor + qualityMode.
 *
 * Three responsibilities:
 *   1. Own the COLOR_GRADE_STAGE PostProcessStage (create, hold, dispose).
 *   2. Provide uniform callbacks driven by runtime state.
 *   3. Toggle stage.enabled per-frame:
 *      - off entirely in 'performance' quality mode
 *      - off at nf < 0.001 (shader is verified identity passthrough;
 *        skip the fullscreen pass during the daytime half of every day)
 */

import { activeCesium } from '../active.svelte';
import { COLOR_GRADE_STAGE } from '../shaders';

export interface ColorGradeConfig {
	readonly additiveStrength: number;
	readonly qualityMode: 'performance' | 'balanced' | 'ultra';
}

export interface ColorGradeSlice {
	/** 0..1 darkness factor (smoothly modulated by sun/moon). */
	readonly nightFactor: number;
	/** 0..1 fade-in for boot — multiplies nightFactor for the first ~1.6s. */
	readonly bootFade: number;
}

/** Module-private — uniform callbacks read these each frame. */
let lastNightFactor = 0;
let lastBootFade = 1;
let lastAdditiveStrength = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let stage: any = null;

/**
 * One-time mount: find or create the COLOR_GRADE_STAGE PostProcessStage
 * and add it to the viewer. Safe to call multiple times.
 *
 * The uniforms use getter callbacks so Cesium reads them every frame;
 * we capture the latest slice state via the sync() interface below.
 */
export function mountColorGrade(glsl: string): void {
	if (stage) return;
	const mgr = activeCesium.manager;
	if (!mgr) return;
	const viewer = mgr.getViewer();
	const C = mgr.getCesium();
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const existing = (viewer.scene.postProcessStages as any).find?.(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(s: any) => s.name === COLOR_GRADE_STAGE,
		);
		if (existing) {
			stage = existing;
			return;
		}
		stage = new C.PostProcessStage({
			name: COLOR_GRADE_STAGE,
			fragmentShader: glsl,
			uniforms: {
				u_nightFactor: () => lastNightFactor * lastBootFade,
				u_additiveStrength: () => lastAdditiveStrength,
			},
		});
		viewer.scene.postProcessStages.add(stage);
	} catch (e) {
		console.warn('[ColorGrade] Post-process failed:', e);
	}
}

/**
 * Per-frame sync — called from compose's #tick. Updates the captured
 * state that the uniform callbacks read, and toggles `enabled` per the
 * day-off + quality-mode rules.
 */
export function syncColorGrade(slice: ColorGradeSlice, config: ColorGradeConfig): void {
	lastNightFactor = slice.nightFactor;
	lastBootFade = slice.bootFade;
	lastAdditiveStrength = config.additiveStrength;

	if (!stage) return;

	// 'performance' mode: stage stays OFF.
	if (config.qualityMode === 'performance') {
		stage.enabled = false;
		return;
	}

	// Day-off: shader is identity at nf < 0.001 — skip the fullscreen pass.
	stage.enabled = slice.nightFactor >= 0.001;
}

/** Tear down the post-process stage. Idempotent. */
export function destroyColorGrade(): void {
	if (!stage) return;
	const mgr = activeCesium.manager;
	if (mgr) mgr.getViewer().scene.postProcessStages.remove(stage);
	stage = null;
}
