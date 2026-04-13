/**
 * WorldEngine — Unified ambient world simulation.
 *
 * Consolidates three previously separate engines:
 *   - AtmosphereEngine  (weather randomisation, lightning)
 *   - EventEngine       (micro-events: birds, shooting stars, contrails)
 *   - DirectorEngine    (auto-pilot location cycling)
 *
 * Returns a WorldPatch each tick so WindowModel can apply changes imperatively.
 */

import { clamp } from '$lib/utils';
import { AIRCRAFT, AMBIENT } from '$lib/constants';
import type { WeatherType, LocationId, SimulationContext, AtmospherePatch, WorldPatch, MicroEventData } from '$lib/types';

// ─── Engine ──────────────────────────────────────────────────────────────────

export class WorldEngine {
	// ── Reactive outputs ──────────────────────────────────────────────────────
	lightningIntensity = $state(0);
	lightningX = $state(50);
	lightningY = $state(40);
	microEvent = $state<MicroEventData | null>(null);

	// ── Private timers ────────────────────────────────────────────────────────
	#lightningTimer = 0;
	#nextLightning = Math.random() * (AIRCRAFT.LIGHTNING_MAX_INTERVAL - AIRCRAFT.LIGHTNING_MIN_INTERVAL) + AIRCRAFT.LIGHTNING_MIN_INTERVAL;

	#randomizeTimer = 0;
	#nextRandomizeTime = AMBIENT.INITIAL_MIN_DELAY + Math.random() * (AMBIENT.INITIAL_MAX_DELAY - AMBIENT.INITIAL_MIN_DELAY);

	#eventTimer = 0;
	#timeToNextEvent = Math.random() * 200 + 100;

	#directorTimer = 0;
	#timeToNextLocation = 120 + Math.random() * 180;

	// ─────────────────────────────────────────────────────────────────────────

	tick(delta: number, ctx: SimulationContext): WorldPatch {
		this.#tickLightning(delta, ctx.showLightning ?? false);
		this.#tickEvents(delta, ctx);

		const patch: WorldPatch = {};

		const atmospherePatch = this.#tickRandomize(delta, ctx);
		if (atmospherePatch) patch.atmosphere = atmospherePatch;

		if (ctx.isOrbitMode) {
			const nextLoc = this.#tickDirector(delta, ctx);
			if (nextLoc) patch.nextLocation = nextLoc;
		}

		return patch;
	}

	resetDirector(): void {
		this.#directorTimer = 0;
		this.#timeToNextLocation = 120 + Math.random() * 180;
	}

	// ─── Lightning ────────────────────────────────────────────────────────────

	#tickLightning(delta: number, showLightning: boolean): void {
		if (!showLightning) { this.lightningIntensity = 0; return; }

		this.#lightningTimer += delta;
		if (this.lightningIntensity > 0) {
			this.lightningIntensity = clamp(this.lightningIntensity - delta * AIRCRAFT.LIGHTNING_DECAY_RATE, 0, 1);
		}
		if (this.lightningIntensity < 0.01 && this.#lightningTimer > this.#nextLightning) {
			this.lightningIntensity = 0.5 + Math.random() * 0.5;
			this.lightningX = 20 + Math.random() * 60;
			this.lightningY = 15 + Math.random() * 50;
			this.#lightningTimer = 0;
			this.#nextLightning = Math.random() * (AIRCRAFT.LIGHTNING_MAX_INTERVAL - AIRCRAFT.LIGHTNING_MIN_INTERVAL) + AIRCRAFT.LIGHTNING_MIN_INTERVAL;
		}
	}

	// ─── Weather randomisation ────────────────────────────────────────────────

	#tickRandomize(delta: number, ctx: SimulationContext): AtmospherePatch | null {
		this.#randomizeTimer += delta;
		if (this.#randomizeTimer < this.#nextRandomizeTime) return null;
		if (ctx.userAdjustingAtmosphere) return null;

		this.#randomizeTimer = 0;
		this.#nextRandomizeTime = AMBIENT.SUBSEQUENT_MIN_DELAY + Math.random() * (AMBIENT.SUBSEQUENT_MAX_DELAY - AMBIENT.SUBSEQUENT_MIN_DELAY);

		const patch: AtmospherePatch = {};
		patch.cloudDensity = clamp(ctx.cloudDensity + (Math.random() - 0.5) * AMBIENT.CLOUD_DENSITY_SHIFT, AMBIENT.CLOUD_DENSITY_MIN, AMBIENT.CLOUD_DENSITY_MAX);
		patch.cloudSpeed   = clamp(ctx.cloudSpeed   + (Math.random() - 0.5) * AMBIENT.CLOUD_SPEED_SHIFT,   AMBIENT.CLOUD_SPEED_MIN,   AMBIENT.CLOUD_SPEED_MAX);
		patch.haze         = clamp(ctx.haze         + (Math.random() - 0.5) * AMBIENT.HAZE_SHIFT,          AMBIENT.HAZE_MIN,          AMBIENT.HAZE_MAX);

		if (Math.random() < AMBIENT.WEATHER_CHANGE_CHANCE) {
			const options: WeatherType[] = ['clear', 'cloudy', 'cloudy', 'rain', 'overcast'];
			patch.weather = options[Math.floor(Math.random() * options.length)];
		}

		return patch;
	}

	// ─── Micro-events ─────────────────────────────────────────────────────────

	#tickEvents(delta: number, ctx: SimulationContext): void {
		if (this.microEvent) {
			this.microEvent.elapsed += delta;
			if (this.microEvent.elapsed >= this.microEvent.duration) {
				this.#eventTimer = 0;
				this.microEvent = null;
			}
			return;
		}

		this.#eventTimer += delta;
		if (this.#eventTimer < this.#timeToNextEvent) return;

		this.#eventTimer = 0;
		this.#timeToNextEvent = Math.random() * 200 + 100;

		const types: Array<'bird' | 'shooting-star' | 'contrail'> = [];
		if (ctx.altitude < 15000 && ctx.skyState === 'day' && ctx.weather !== 'rain' && ctx.weather !== 'overcast') types.push('bird');
		if (ctx.skyState === 'night' && ctx.cloudDensity < 0.5) types.push('shooting-star');
		if (ctx.skyState === 'day' && ctx.altitude > 20000 && ctx.cloudDensity < 0.8) types.push('contrail');
		if (types.length === 0) return;

		const type = types[Math.floor(Math.random() * types.length)];
		const duration = type === 'bird' ? 8 : type === 'shooting-star' ? 1.5 : 45;
		this.microEvent = { type, duration, elapsed: 0, x: 10 + Math.random() * 80, y: type === 'bird' ? 20 + Math.random() * 60 : 10 + Math.random() * 30 };
	}

	// ─── Auto-pilot director ──────────────────────────────────────────────────

	#tickDirector(delta: number, ctx: SimulationContext): LocationId | null {
		if (ctx.userAdjustingAltitude || ctx.userAdjustingTime) { this.#directorTimer = 0; return null; }

		this.#directorTimer += delta;
		if (this.#directorTimer > this.#timeToNextLocation) {
			this.#directorTimer = 0;
			return ctx.pickNextLocation!();
		}
		return null;
	}
}
