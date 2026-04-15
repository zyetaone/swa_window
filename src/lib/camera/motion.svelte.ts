/**
 * MotionEngine — turbulence, banking, breathing, engine vibration.
 */

import { untrack } from 'svelte';
import { clamp, shortestAngleDelta, randomBetween } from '$lib/utils';
import { AIRCRAFT, FLIGHT_FEEL } from '$lib/constants';
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
	#nextBump = randomBetween(FLIGHT_FEEL.BUMP_MIN_INTERVAL, FLIGHT_FEEL.BUMP_MAX_INTERVAL);
	#bumpElapsed = -1;
	#bumpSign = 1;

	tick(delta: number, ctx: SimulationContext): void {
		// Hot path — wrap in untrack() so config reads don't build 60 Hz deps.
		untrack(() => this.#tickInternal(delta, ctx));
	}

	#tickInternal(delta: number, ctx: SimulationContext): void {
		const { time: t, heading, altitude, turbulenceLevel } = ctx;
		const turbMult = AIRCRAFT.TURBULENCE_MULTIPLIERS[turbulenceLevel];

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
			bumpValue = this.#bumpSign * FLIGHT_FEEL.BUMP_AMPLITUDE * turbMult
				* Math.exp(-FLIGHT_FEEL.BUMP_DECAY * this.#bumpElapsed)
				* Math.sin(FLIGHT_FEEL.BUMP_RING_FREQ * this.#bumpElapsed);
			if (this.#bumpElapsed > 1.5) this.#bumpElapsed = -1;
		} else if (this.#bumpTimer > this.#nextBump) {
			this.#bumpTimer = 0;
			this.#bumpElapsed = 0;
			this.#bumpSign = Math.random() > 0.5 ? 1 : -1;
			this.#nextBump = randomBetween(FLIGHT_FEEL.BUMP_MIN_INTERVAL, FLIGHT_FEEL.BUMP_MAX_INTERVAL) / turbMult;
		}

		this.motionOffsetY = (baseTurbY * AIRCRAFT.TURBULENCE_OFFSET_Y + chatterY + bumpValue) * altFactor;
		this.motionOffsetX = (baseTurbX * AIRCRAFT.TURBULENCE_OFFSET_Y * 0.3 + chatterX) * altFactor;

		const hDelta = shortestAngleDelta(this.#prevHeading, heading);
		const turnRate = delta > 0 ? hDelta / delta : 0;
		const targetBank = clamp(turnRate * 0.3, -FLIGHT_FEEL.BANK_ANGLE_MAX, FLIGHT_FEEL.BANK_ANGLE_MAX);
		this.bankAngle += (targetBank - this.bankAngle) * Math.min(FLIGHT_FEEL.BANK_SMOOTHING * delta, 1);
		this.#prevHeading = heading;

		this.breathingOffset = Math.sin(t * (2 * Math.PI / FLIGHT_FEEL.BREATHING_PERIOD));

		this.engineVibeX = Math.sin(t * FLIGHT_FEEL.ENGINE_VIBE_FREQ_X) * FLIGHT_FEEL.ENGINE_VIBE_AMP;
		this.engineVibeY = Math.sin(t * FLIGHT_FEEL.ENGINE_VIBE_FREQ_Y) * FLIGHT_FEEL.ENGINE_VIBE_AMP;
	}
}
