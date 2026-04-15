/**
 * MotionEngine — turbulence, banking, breathing, engine vibration.
 *
 * All feel parameters are read from `ctx.camera.motion` (CameraConfig.MotionConfig).
 * This engine is the first Phase 5 migration off constants.ts — FLIGHT_FEEL and
 * AIRCRAFT.TURBULENCE_* are no longer imported here.
 */

import { untrack } from 'svelte';
import { clamp, shortestAngleDelta, randomBetween } from '$lib/utils';
import type { SimulationContext } from '$lib/types';

export class MotionEngine {
	// ── Reactive outputs ───────────────────────────────────────────────────────
	motionOffsetX = $state(0);
	motionOffsetY = $state(0);
	bankAngle = $state(0);
	breathingOffset = $state(0);
	engineVibeX = $state(0);
	engineVibeY = $state(0);

	// ── Internal state ─────────────────────────────────────────────────────────
	#prevHeading = 0;
	#bumpTimer = 0;
	#nextBump: number;
	#bumpElapsed = -1;
	#bumpSign = 1;

	constructor() {
		this.#nextBump = randomBetween(30, 120);
	}

	tick(delta: number, ctx: SimulationContext): void {
		untrack(() => this.#tickInternal(delta, ctx));
	}

	#tickInternal(delta: number, ctx: SimulationContext): void {
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

		let bumpValue = 0;
		this.#bumpTimer += delta;

		if (this.#bumpElapsed >= 0) {
			this.#bumpElapsed += delta;
			bumpValue = this.#bumpSign * m.bumpAmplitude * turbMult
				* Math.exp(-m.bumpDecay * this.#bumpElapsed)
				* Math.sin(m.bumpRingFreq * this.#bumpElapsed);
			if (this.#bumpElapsed > 1.5) this.#bumpElapsed = -1;
		} else if (this.#bumpTimer > this.#nextBump) {
			this.#bumpTimer = 0;
			this.#bumpElapsed = 0;
			this.#bumpSign = Math.random() > 0.5 ? 1 : -1;
			this.#nextBump = randomBetween(m.bumpMinInterval, m.bumpMaxInterval) / turbMult;
		}

		this.motionOffsetY = (baseTurbY * m.turbulenceOffsetY + chatterY + bumpValue) * altFactor;
		this.motionOffsetX = (baseTurbX * m.turbulenceOffsetY * 0.3 + chatterX) * altFactor;

		const hDelta = shortestAngleDelta(this.#prevHeading, heading);
		const turnRate = delta > 0 ? hDelta / delta : 0;
		const targetBank = clamp(turnRate * 0.3, -m.bankAngleMax, m.bankAngleMax);
		this.bankAngle += (targetBank - this.bankAngle) * Math.min(m.bankSmoothing * delta, 1);
		this.#prevHeading = heading;

		this.breathingOffset = Math.sin(t * (2 * Math.PI / m.breathingPeriod));

		this.engineVibeX = Math.sin(t * m.engineVibeFreqX) * m.engineVibeAmp;
		this.engineVibeY = Math.sin(t * m.engineVibeFreqY) * m.engineVibeAmp;
	}
}
