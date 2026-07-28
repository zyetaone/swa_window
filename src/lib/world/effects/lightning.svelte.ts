/**
 * lightning — Cesium-native post-process stage for ambient scene flash.
 *
 * Reactive feature: shader uniforms come from $effect-synced state,
 * the strike timer is an imperative RAF loop because it's time-driven
 * simulation (not a state-driven effect). $effect.root() gives the
 * RAF loop non-component lifetime.
 *
 * Strike composition (sheet / forked / distant) is picked once per
 * storm from $content/compositions/lightning and drives timing,
 * intensity, and screen-space placement.
 */

import type * as CesiumType from 'cesium';
import { randomBetween, clamp } from '$lib/utils';
import {
	pickLightningComposition,
	type LightningComposition,
} from '$content/compositions/lightning';
import { activeCesium } from '../active.svelte';

const STAGE_NAME = 'aero-lightning';

const LIGHTNING_GLSL = /* glsl */ `
	uniform sampler2D colorTexture;
	uniform float u_flash;
	uniform float u_strike_x;
	uniform float u_strike_y;
	in vec2 v_textureCoordinates;

	void main() {
		vec4 color = texture(colorTexture, v_textureCoordinates);
		if (u_flash < 0.001) {
			out_FragColor = color;
			return;
		}

		// Distance from this fragment to the strike center, in normalised
		// screen space. A wide ellipse so the flash reads as ambient
		// world-lighting rather than a hard halo.
		vec2 d = v_textureCoordinates - vec2(u_strike_x, u_strike_y);
		d.x *= 1.2;        // slight horizontal stretch
		float dist = length(d);
		float radial = 1.0 - smoothstep(0.0, 1.0, dist);

		// Cool blue-white wash — matches the previous DOM gradient's
		// (200, 200, 255) → (150, 150, 230) palette.
		vec3 flashColor = mix(
			vec3(0.59, 0.59, 0.90),
			vec3(0.78, 0.78, 1.0),
			radial,
		);

		// Additive blend, saturated by u_flash. Centre fragments get full
		// contribution; edges still receive ~30% of the flash for the
		// "the sky just lit up" feel.
		float gain = u_flash * (0.3 + 0.7 * radial);
		out_FragColor = vec4(color.rgb + flashColor * gain, color.a);
	}
`;

export interface WeatherSlice {
	hasLightning: boolean;
	lightningDecayRate: number;
	lightningMinInterval: number;
	lightningMaxInterval: number;
}

/** Module-private lightning state — uniform callbacks read these each frame. */
let flash = 0;          // 0..1 current flash intensity
let x = 0.5;            // strike screen-x (0..1)
let y = 0.4;            // strike screen-y
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let stage: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createStage(C: typeof CesiumType, _viewer: CesiumType.Viewer): any {
	const CAny = C as any;
	return new CAny.PostProcessStage({
		name: STAGE_NAME,
		fragmentShader: LIGHTNING_GLSL,
		uniforms: {
			u_flash: () => flash,
			u_strike_x: () => x,
			u_strike_y: () => y,
		},
	});
}

/**
 * One-time mount: create the PostProcessStage and add it to the scene.
 * Safe to call multiple times — idempotent.
 */
export function mountLightning(): void {
	if (stage) return;
	const mgr = activeCesium.manager;
	if (!mgr) return;
	const viewer = mgr.getViewer();
	const C = mgr.getCesium();
	stage = createStage(C, viewer);
	stage.enabled = false;     // toggled on when first strike fires
	viewer.scene.postProcessStages.add(stage);
}

/**
 * Tear down the post-process stage. Idempotent.
 */
export function destroyLightning(): void {
	if (!stage) return;
	const mgr = activeCesium.manager;
	if (mgr) mgr.getViewer().scene.postProcessStages.remove(stage);
	stage = null;
}

/**
 * Per-frame tick — drives the strike timer and the flash decay envelope.
 * Imperative because it's time-driven simulation, not state sync.
 *
 * @param delta            seconds since last call
 * @param weather          weather slice (hasLightning + intervals)
 */
let timer = 0;
let nextStrike = 10;
let composition: LightningComposition | null = null;
let prevHasLightning = false;

export function tickLightning(delta: number, weather: WeatherSlice): void {
	if (!stage) return;

	// Roll a new composition when storm starts; clear when it ends.
	if (weather.hasLightning && !prevHasLightning) {
		composition = pickLightningComposition();
	} else if (!weather.hasLightning && prevHasLightning) {
		composition = null;
	}
	prevHasLightning = weather.hasLightning;

	if (!weather.hasLightning) {
		flash = 0;
		stage.enabled = false;
		return;
	}

	stage.enabled = true;

	const c = composition;
	const decayRate = c?.decayRate ?? weather.lightningDecayRate;

	timer += delta;
	if (flash > 0) {
		flash = clamp(flash - delta * decayRate, 0, 1);
	}
	if (flash < 0.01 && timer > nextStrike) {
		if (c) {
			flash = randomBetween(c.intensityRange[0], c.intensityRange[1]);
			// Recipes are in percent (0..100); shader wants 0..1.
			x = randomBetween(c.xRange[0], c.xRange[1]) / 100;
			y = randomBetween(c.yRange[0], c.yRange[1]) / 100;
			nextStrike = randomBetween(c.intervalRange[0], c.intervalRange[1]);
		} else {
			flash = randomBetween(0.5, 1);
			x = randomBetween(20, 80) / 100;
			y = randomBetween(15, 65) / 100;
			nextStrike = randomBetween(
				weather.lightningMinInterval,
				weather.lightningMaxInterval,
			);
		}
		timer = 0;
	}
}

/** Read-only access to module state — useful for tests / diagnostics. */
export function _lightningDebug(): { flash: number; enabled: boolean } {
	return { flash, enabled: stage?.enabled ?? false };
}
