/**
 * lightning — Cesium-native post-process stage for ambient scene flash.
 *
 * Reactive feature: shader uniforms come from module-level state read
 * via uniform callbacks; the strike timer is an imperative RAF loop
 * because it's time-driven simulation (not a state-driven effect).
 *
 * Composition picker (sheet / forked / distant) drives the timing,
 * intensity, and x/y placement — same recipes as before.
 */

import { randomBetween, clamp } from '$lib/utils';
import {
	pickLightningComposition,
	type LightningComposition,
} from '$content/compositions/lightning';
import { activeCesium } from './active.svelte';

const STAGE_NAME = 'aero-lightning';

const LIGHTNING_GLSL = /* glsl */ `
	uniform sampler2D colorTexture;
	uniform float u_flash;
	uniform float u_strike_x;
	uniform float u_strike_y;
	in vec2 v_textureCoordinates;

	void main() {
		vec4 color = texture(colorTexture, v_textureCoordinates);
		if (u_flash < 0.001) { out_FragColor = color; return; }

		vec2 d = v_textureCoordinates - vec2(u_strike_x, u_strike_y);
		d.x *= 1.2;
		float dist = length(d);
		float radial = 1.0 - smoothstep(0.0, 1.0, dist);

		vec3 flashColor = mix(vec3(0.59, 0.59, 0.90), vec3(0.78, 0.78, 1.0), radial);

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

// Module-private state — uniform callbacks read these each frame.
let _flash = 0;
let _x = 0.5;
let _y = 0.4;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _stage: any = null;
let _timer = 0;
let _nextStrike = 10;
let _composition: LightningComposition | null = null;
let _prevHasLightning = false;

/**
 * One-time mount: create the PostProcessStage and add it to the scene.
 * Idempotent.
 */
export function mountLightning(): void {
	if (_stage) return;
	const mgr = activeCesium.manager;
	if (!mgr) return;
	const viewer = mgr.getViewer();
	const C = mgr.getCesium() as any;
	_stage = new C.PostProcessStage({
		name: STAGE_NAME,
		fragmentShader: LIGHTNING_GLSL,
		uniforms: {
			u_flash: () => _flash,
			u_strike_x: () => _x,
			u_strike_y: () => _y,
		},
	});
	_stage.enabled = false;
	viewer.scene.postProcessStages.add(_stage);
}

/**
 * Per-frame strike timing + flash decay. Imperative because it's
 * time-driven simulation, not state sync.
 */
export function tickLightning(delta: number, weather: WeatherSlice): void {
	if (!_stage) return;

	if (weather.hasLightning && !_prevHasLightning) {
		_composition = pickLightningComposition();
	} else if (!weather.hasLightning && _prevHasLightning) {
		_composition = null;
	}
	_prevHasLightning = weather.hasLightning;

	if (!weather.hasLightning) {
		_flash = 0;
		_stage.enabled = false;
		return;
	}

	_stage.enabled = true;

	const c = _composition;
	const decayRate = c?.decayRate ?? weather.lightningDecayRate;

	_timer += delta;
	if (_flash > 0) {
		_flash = clamp(_flash - delta * decayRate, 0, 1);
	}
	if (_flash < 0.01 && _timer > _nextStrike) {
		if (c) {
			_flash = randomBetween(c.intensityRange[0], c.intensityRange[1]);
			// Recipes are in percent (0..100); shader wants 0..1.
			_x = randomBetween(c.xRange[0], c.xRange[1]) / 100;
			_y = randomBetween(c.yRange[0], c.yRange[1]) / 100;
			_nextStrike = randomBetween(c.intervalRange[0], c.intervalRange[1]);
		} else {
			_flash = randomBetween(0.5, 1);
			_x = randomBetween(20, 80) / 100;
			_y = randomBetween(15, 65) / 100;
			_nextStrike = randomBetween(
				weather.lightningMinInterval,
				weather.lightningMaxInterval,
			);
		}
		_timer = 0;
	}
}

/** Tear down the post-process stage. Idempotent. */
export function destroyLightning(): void {
	if (!_stage) return;
	const mgr = activeCesium.manager;
	if (mgr) mgr.getViewer().scene.postProcessStages.remove(_stage);
	_stage = null;
	_timer = 0;
	_nextStrike = 10;
	_composition = null;
	_prevHasLightning = false;
	_flash = 0;
}
