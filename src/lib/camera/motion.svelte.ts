/**
 * Motion — turbulence, banking, breathing, engine vibration.
 *
 * Converted from MotionEngine class to module: six reactive outputs live
 * as fields on the exported `motion` object; four private timers are
 * module-local `let`. The app has one motion producer (singleton) — no
 * multi-instance use case exists, so the class was ceremony.
 *
 * AeroWindow.motion returns this module's `motion` object (a getter, not
 * a field), keeping `model.motion.x` callsites untouched across
 * Pane.svelte + compose.ts.
 *
 * All feel parameters are read from `ctx.camera.motion` (CameraConfig.MotionConfig).
 */

import { untrack } from 'svelte';
import { clamp, shortestAngleDelta, randomBetween } from '$lib/utils';
import type { SimulationContext } from '$lib/types';

// ── Reactive outputs ────────────────────────────────────────────────────────

export const motion = $state({
	motionOffsetX: 0,
	motionOffsetY: 0,
	bankAngle: 0,
	breathingOffset: 0,
	engineVibeX: 0,
	engineVibeY: 0,
});

// ── Internal timer state (not reactive) ─────────────────────────────────────

let _prevHeading = 0;
let _bumpTimer = 0;
// Lazy-init on first tick from ctx.camera.motion.bumpMin/MaxInterval (live
// config). Earlier this was seeded at module load with hardcoded (30, 120) —
// same fleet-sync class of bug as the autopilot init seeds: every Pi
// imported the module at roughly the same boot moment and (V8's RNG aside)
// could pick correlated first-bump times. Now sampled on first real tick
// against the live config window, so admin tuning is honored and every
// device picks its own.
let _nextBump: number | null = null;
let _bumpElapsed = -1;
let _bumpSign = 1;

// ── Tick ────────────────────────────────────────────────────────────────────

export function motionStep(delta: number, ctx: SimulationContext): void {
	untrack(() => tickInternal(delta, ctx));
}

function tickInternal(delta: number, ctx: SimulationContext): void {
	const { time: t, heading, altitude, turbulenceLevel, camera } = ctx;
	const m = camera.motion;
	const turbMult = m.turbulenceMultipliers[turbulenceLevel];

	const altFactor = altitude > 40000
		? clamp(1 - (altitude - 40000) / 10000, 0.05, 1)
		: 1;

	const baseTurbY = (Math.sin(t * 0.5) * 0.1 + Math.sin(t * 1.1) * 0.08) * turbMult;
	const baseTurbX = (Math.sin(t * 0.37) * 0.08 + Math.sin(t * 0.83) * 0.06) * turbMult;

	const chatterY = (Math.sin(t * 2.5 * Math.PI * 2) * 0.03
		+ Math.sin(t * 3.7 * Math.PI * 2) * 0.02) * turbMult;
	const chatterX = (Math.sin(t * 2.1 * Math.PI * 2) * 0.01
		+ Math.sin(t * 3.3 * Math.PI * 2) * 0.008) * turbMult;

	if (_nextBump === null) {
		_nextBump = randomBetween(m.bumpMinInterval, m.bumpMaxInterval) / turbMult;
	}

	let bumpValue = 0;
	_bumpTimer += delta;

	if (_bumpElapsed >= 0) {
		_bumpElapsed += delta;
		// Phase 10b — soft onset envelope (1 - exp(-8t)) reaches ~80% at 200ms
		// and ~95% at 370ms. Without it, the bump's first sin-peak (at t ≈
		// π/(2*ringFreq) ≈ 220ms) lands at full amplitude and reads as a JERK
		// rather than a swell. With the envelope, peak energy arrives just as
		// the envelope reaches ~85%, giving a smoother rise even at the same
		// peak amplitude.
		const onset = 1 - Math.exp(-8 * _bumpElapsed);
		bumpValue = _bumpSign * m.bumpAmplitude * turbMult
			* Math.exp(-m.bumpDecay * _bumpElapsed)
			* Math.sin(m.bumpRingFreq * _bumpElapsed)
			* onset;
		if (_bumpElapsed > 1.5) _bumpElapsed = -1;
	} else if (_bumpTimer > _nextBump) {
		_bumpTimer = 0;
		_bumpElapsed = 0;
		_bumpSign = Math.random() > 0.5 ? 1 : -1;
		_nextBump = randomBetween(m.bumpMinInterval, m.bumpMaxInterval) / turbMult;
	}

	motion.motionOffsetY = (baseTurbY * m.turbulenceOffsetY + chatterY + bumpValue) * altFactor;
	motion.motionOffsetX = (baseTurbX * m.turbulenceOffsetY * 0.3 + chatterX) * altFactor;

	const hDelta = shortestAngleDelta(_prevHeading, heading);
	const turnRate = delta > 0 ? hDelta / delta : 0;
	const targetBank = clamp(turnRate * 0.3, -m.bankAngleMax, m.bankAngleMax);
	motion.bankAngle += (targetBank - motion.bankAngle) * Math.min(m.bankSmoothing * delta, 1);
	_prevHeading = heading;

	motion.breathingOffset = Math.sin(t * (2 * Math.PI / m.breathingPeriod));

	motion.engineVibeX = Math.sin(t * m.engineVibeFreqX) * m.engineVibeAmp;
	motion.engineVibeY = Math.sin(t * m.engineVibeFreqY) * m.engineVibeAmp;
}
