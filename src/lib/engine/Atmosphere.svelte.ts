/**
 * AtmosphereEngine — lightning + ambient randomization.
 *
 * Lightning: random flashes during storm weather.
 * Randomization: slow-drifts cloud density, haze, speed, weather.
 *
 * tickRandomize returns a patch (intention) rather than mutating shared
 * state directly — the coordinator applies it. This prevents the engine
 * from conflicting with UI/fleet writes to the same fields.
 */

import { clamp } from '$lib/shared/utils';
import { AIRCRAFT, AMBIENT } from '$lib/shared/constants';
import type { WeatherType } from '$lib/shared/types';

export interface AtmospherePatch {
	cloudDensity?: number;
	cloudSpeed?: number;
	haze?: number;
	weather?: WeatherType;
}

export class AtmosphereEngine {
	// ── Lightning (reactive outputs) ────────────────────────────────────────────
	lightningIntensity = $state(0);
	lightningX = $state(50);
	lightningY = $state(40);

	private lightningTimer = 0;
	private nextLightning = Math.random()
		* (AIRCRAFT.LIGHTNING_MAX_INTERVAL - AIRCRAFT.LIGHTNING_MIN_INTERVAL)
		+ AIRCRAFT.LIGHTNING_MIN_INTERVAL;

	// ── Ambient randomization (internal timers) ────────────────────────────────
	private randomizeTimer = 0;
	private nextRandomizeTime = AMBIENT.INITIAL_MIN_DELAY
		+ Math.random() * (AMBIENT.INITIAL_MAX_DELAY - AMBIENT.INITIAL_MIN_DELAY);

	tickLightning(delta: number, showLightning: boolean): void {
		if (showLightning) {
			this.lightningTimer += delta;
			if (this.lightningIntensity > 0) {
				this.lightningIntensity = clamp(
					this.lightningIntensity - delta * AIRCRAFT.LIGHTNING_DECAY_RATE, 0, 1,
				);
			}
			if (this.lightningIntensity < 0.01 && this.lightningTimer > this.nextLightning) {
				this.lightningIntensity = 0.5 + Math.random() * 0.5;
				this.lightningX = 20 + Math.random() * 60;
				this.lightningY = 15 + Math.random() * 50;
				this.lightningTimer = 0;
				this.nextLightning = Math.random()
					* (AIRCRAFT.LIGHTNING_MAX_INTERVAL - AIRCRAFT.LIGHTNING_MIN_INTERVAL)
					+ AIRCRAFT.LIGHTNING_MIN_INTERVAL;
			}
		} else {
			this.lightningIntensity = 0;
		}
	}

	/** Returns a patch of ambient shifts, or null if no change this frame. */
	tickRandomize(delta: number, ctx: {
		userAdjusting: boolean;
		cloudDensity: number;
		cloudSpeed: number;
		haze: number;
	}): AtmospherePatch | null {
		this.randomizeTimer += delta;
		if (this.randomizeTimer < this.nextRandomizeTime) return null;
		if (ctx.userAdjusting) return null;

		this.randomizeTimer = 0;
		this.nextRandomizeTime = AMBIENT.SUBSEQUENT_MIN_DELAY
			+ Math.random() * (AMBIENT.SUBSEQUENT_MAX_DELAY - AMBIENT.SUBSEQUENT_MIN_DELAY);

		const patch: AtmospherePatch = {};

		const cloudShift = (Math.random() - 0.5) * AMBIENT.CLOUD_DENSITY_SHIFT;
		patch.cloudDensity = clamp(ctx.cloudDensity + cloudShift, AMBIENT.CLOUD_DENSITY_MIN, AMBIENT.CLOUD_DENSITY_MAX);

		const speedShift = (Math.random() - 0.5) * AMBIENT.CLOUD_SPEED_SHIFT;
		patch.cloudSpeed = clamp(ctx.cloudSpeed + speedShift, AMBIENT.CLOUD_SPEED_MIN, AMBIENT.CLOUD_SPEED_MAX);

		const hazeShift = (Math.random() - 0.5) * AMBIENT.HAZE_SHIFT;
		patch.haze = clamp(ctx.haze + hazeShift, AMBIENT.HAZE_MIN, AMBIENT.HAZE_MAX);

		if (Math.random() < AMBIENT.WEATHER_CHANGE_CHANCE) {
			const options: WeatherType[] = ['clear', 'cloudy', 'cloudy', 'rain', 'overcast'];
			patch.weather = options[Math.floor(Math.random() * options.length)];
		}

		return patch;
	}
}
