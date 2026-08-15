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
import type * as CesiumType from 'cesium';
import {
	pickLightningComposition,
	type LightningComposition,
} from '$content/compositions/lightning';
import { createSeededRng, daySeed } from './prng';
import { registerViewerTeardown } from './viewer-lifecycle';

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

interface WeatherSlice {
	hasLightning: boolean;
	lightningDecayRate: number;
	lightningMinInterval: number;
	lightningMaxInterval: number;
}

// Module-private state — uniform callbacks read these each frame.
let _flash = 0;
let _x = 0.5;
let _y = 0.4;
let _viewer: CesiumType.Viewer | null = null;
let _stage: CesiumType.PostProcessStage | null = null;
let _composition: LightningComposition | null = null;
let _prevHasLightning = false;
let _timer = 0;
let _nextStrike = 10;

// Deterministic strike sequence (invariant #4). Lightning is a FULL-SCREEN
// flash, so if each Pi rolled its own timings the panorama would flash
// out of sync — the most visible seam of any effect. All three Pis share
// daySeed() and receive the same broadcast weather, so seeding the storm
// from (daySeed ^ stormIndex) makes them agree with no extra messaging.
//
// `_stormIndex` counts hasLightning false→true transitions. It stays in
// step across Pis because `hasLightning` is derived from the leader's
// broadcast weather, so every device sees the same transitions.
let _stormIndex = 0;
let _rng: () => number = Math.random;

const STORM_SALT = 0x5c07;

/** Reset the strike sequence for a new storm. */
function beginStorm(index: number = _stormIndex): void {
	_rng = createSeededRng((daySeed() ^ (index * STORM_SALT)) >>> 0);
	_composition = pickLightningComposition(_rng);
	_timer = 0;
	_flash = 0;
	_nextStrike = randomBetween(
		_composition.intervalRange[0],
		_composition.intervalRange[1],
		_rng,
	);
}

/**
 * One-time mount: create the PostProcessStage and add it to the scene.
 * Idempotent. Accepts the live Cesium + Viewer from CesiumManager so the
 * module mounts BEFORE `activeCesium.manager` is published by the viewer.
 *
 * Liveness-guarded: a latched `_stage` is only valid while its viewer lives.
 * If `onDestroy` fired while `CesiumManager.start()` was suspended in an
 * await, `destroy()` ran first and `start()` then resumes calling this on a
 * destroyed viewer — mounting there would latch a stage against a dead scene
 * and the bare `_stage` check would keep every later (live) mount out for the
 * rest of the session.
 */
export function mountLightning(C: typeof CesiumType, viewer: CesiumType.Viewer): void {
	if (_stage) {
		if (_viewer && !_viewer.isDestroyed?.()) return;
		// Stale latch from a destroyed viewer — drop it and remount below.
		_stage = null;
	}
	// Never mount onto a viewer that is already destroyed (start() resuming
	// after destroy()): the stage would be unreachable by the next live mount.
	if (viewer.isDestroyed()) return;
	// Keep the viewer so destroyLightning can detach the stage without
	// depending on activeCesium (which may already be cleared at teardown).
	_viewer = viewer;
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
		beginStorm(_stormIndex);
		_stormIndex++;
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
			_flash = randomBetween(c.intensityRange[0], c.intensityRange[1], _rng);
			// Recipes are in percent (0..100); shader wants 0..1.
			_x = randomBetween(c.xRange[0], c.xRange[1], _rng) / 100;
			_y = randomBetween(c.yRange[0], c.yRange[1], _rng) / 100;
			// The composition owns the cadence — that is what makes 'sheet'
			// (slow, high, dim) read differently from 'forked' (fast, low,
			// bright). Falling back to the generic weather interval here
			// collapsed all three recipes onto one rhythm.
			_nextStrike = randomBetween(c.intervalRange[0], c.intervalRange[1], _rng);
		} else {
			_flash = randomBetween(0.5, 1, _rng);
			_x = randomBetween(20, 80, _rng) / 100;
			_y = randomBetween(15, 65, _rng) / 100;
			_nextStrike = randomBetween(
				weather.lightningMinInterval,
				weather.lightningMaxInterval,
				_rng,
			);
		}
		_timer = 0;
	}
}

/** Tear down the post-process stage. Idempotent. */
export function destroyLightning(): void {
	if (!_stage) return;
	if (_viewer && !_viewer.isDestroyed?.()) {
		_viewer.scene.postProcessStages.remove(_stage);
	}
	_stage = null;
	_viewer = null;
	_timer = 0;
	_nextStrike = 10;
	_flash = 0;
	_composition = null;
	_prevHasLightning = false;
	// Storm counter is session state, not viewer state — but a destroy means
	// the pipeline restarts from boot, so the next storm must reseed from 0
	// or its character silently shifts for the rest of the new session.
	_stormIndex = 0;
}

// Teardown was already explicit here; registering puts it in the single list
// so CesiumManager.destroy() no longer has to name subsystems individually.
registerViewerTeardown('lightning', destroyLightning);
