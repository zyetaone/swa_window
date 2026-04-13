/**
 * MotionEngine — turbulence, banking, breathing, engine vibration.
 *
 * Pure simulation: reads flight context, writes motion offsets.
 * No DOM, no Cesium, no Svelte components.
 *
 * Output fields are $state so consumers (Window.svelte, CesiumManager)
 * react automatically when values change.
 */

import { clamp } from '$lib/shared/utils';
import { AIRCRAFT, FLIGHT_FEEL } from '$lib/shared/constants';
import type { WeatherType } from '$lib/shared/types';

export interface MotionContext {
	time: number;
	heading: number;
	altitude: number;
	weather: WeatherType;
	turbulenceLevel: 'light' | 'moderate' | 'severe';
}

export class MotionEngine {
	// ── Reactive outputs (read by Window.svelte, CesiumManager) ─────────────
	motionOffsetX = $state(0);
	motionOffsetY = $state(0);
	bankAngle = $state(0);
	breathingOffset = $state(0);
	engineVibeX = $state(0);
	engineVibeY = $state(0);

	// ── Internal state ─────────────────────────────────────────────────────────
	private prevHeading = 0;
	private bumpTimer = 0;
	private nextBump = FLIGHT_FEEL.BUMP_MIN_INTERVAL
		+ Math.random() * (FLIGHT_FEEL.BUMP_MAX_INTERVAL - FLIGHT_FEEL.BUMP_MIN_INTERVAL);
	private bumpElapsed = -1;
	private bumpSign = 1;

	tick(delta: number, ctx: MotionContext): void {
		const { time: t, heading, altitude, weather, turbulenceLevel } = ctx;
		const turbMult = AIRCRAFT.TURBULENCE_MULTIPLIERS[turbulenceLevel];

		// Above 40k ft in clear weather → dampen turbulence (smooth stratosphere)
		const altFactor = altitude > 40000 && weather === 'clear'
			? clamp(1 - (altitude - 40000) / 10000, 0.05, 1)
			: 1;

		// Base turbulence — low-frequency oscillation
		const baseTurbY = (Math.sin(t * 0.5) * 0.1 + Math.sin(t * 1.1) * 0.08) * turbMult;
		const baseTurbX = (Math.sin(t * 0.37) * 0.08 + Math.sin(t * 0.83) * 0.06) * turbMult;

		// High-frequency chatter
		const chatterY = (Math.sin(t * 2.5 * Math.PI * 2) * 0.03
			+ Math.sin(t * 3.7 * Math.PI * 2) * 0.02) * turbMult;
		const chatterX = (Math.sin(t * 2.1 * Math.PI * 2) * 0.01
			+ Math.sin(t * 3.3 * Math.PI * 2) * 0.008) * turbMult;

		// Occasional air-pocket bumps
		const bumpAmpScale = turbMult;
		const bumpIntervalScale = 1 / turbMult;
		let bumpValue = 0;
		this.bumpTimer += delta;

		if (this.bumpElapsed >= 0) {
			this.bumpElapsed += delta;
			bumpValue = this.bumpSign * FLIGHT_FEEL.BUMP_AMPLITUDE * bumpAmpScale
				* Math.exp(-FLIGHT_FEEL.BUMP_DECAY * this.bumpElapsed)
				* Math.sin(FLIGHT_FEEL.BUMP_RING_FREQ * this.bumpElapsed);
			if (this.bumpElapsed > 1.5) this.bumpElapsed = -1;
		} else if (this.bumpTimer > this.nextBump) {
			this.bumpTimer = 0;
			this.bumpElapsed = 0;
			this.bumpSign = Math.random() > 0.5 ? 1 : -1;
			this.nextBump = (FLIGHT_FEEL.BUMP_MIN_INTERVAL
				+ Math.random() * (FLIGHT_FEEL.BUMP_MAX_INTERVAL - FLIGHT_FEEL.BUMP_MIN_INTERVAL))
				* bumpIntervalScale;
		}

		// Write output offsets
		this.motionOffsetY = (baseTurbY * AIRCRAFT.TURBULENCE_OFFSET_Y + chatterY + bumpValue) * altFactor;
		this.motionOffsetX = (baseTurbX * AIRCRAFT.TURBULENCE_OFFSET_Y * 0.3 + chatterX) * altFactor;

		// Bank angle from turn rate
		let headingDelta = heading - this.prevHeading;
		if (headingDelta > 180) headingDelta -= 360;
		if (headingDelta < -180) headingDelta += 360;
		const turnRate = delta > 0 ? headingDelta / delta : 0;
		const targetBank = clamp(turnRate * 0.3, -FLIGHT_FEEL.BANK_ANGLE_MAX, FLIGHT_FEEL.BANK_ANGLE_MAX);
		this.bankAngle += (targetBank - this.bankAngle) * Math.min(FLIGHT_FEEL.BANK_SMOOTHING * delta, 1);
		this.prevHeading = heading;

		// Breathing — slow pitch oscillation
		this.breathingOffset = Math.sin(t * (2 * Math.PI / FLIGHT_FEEL.BREATHING_PERIOD));

		// Engine vibration — high-frequency hum
		this.engineVibeX = Math.sin(t * FLIGHT_FEEL.ENGINE_VIBE_FREQ_X) * FLIGHT_FEEL.ENGINE_VIBE_AMP;
		this.engineVibeY = Math.sin(t * FLIGHT_FEEL.ENGINE_VIBE_FREQ_Y) * FLIGHT_FEEL.ENGINE_VIBE_AMP;
	}
}
