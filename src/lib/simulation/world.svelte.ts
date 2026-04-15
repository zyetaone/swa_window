/**
 * WorldEngine — ambient world simulation (weather randomization + auto-pilot director).
 *
 * Returns a WorldPatch each tick so WindowModel can apply changes imperatively.
 * Effect state (lightning, micro-events) lives in scene/effects/ — each effect
 * subscribes to the game-loop independently.
 */

import { clamp, randomBetween, pickRandom } from '$lib/utils';
import { AMBIENT } from '$lib/constants';
import type { LocationId, SimulationContext, AtmospherePatch, WorldPatch } from '$lib/types';

// ─── Engine ──────────────────────────────────────────────────────────────────

export class WorldEngine {
	// ── Private timers ────────────────────────────────────────────────────────
	#randomizeTimer = 0;
	#nextRandomizeTime = randomBetween(AMBIENT.INITIAL_MIN_DELAY, AMBIENT.INITIAL_MAX_DELAY);

	#directorTimer = 0;
	#timeToNextLocation = randomBetween(AMBIENT.DIRECTOR_MIN_INTERVAL, AMBIENT.DIRECTOR_MAX_INTERVAL);

	// ─────────────────────────────────────────────────────────────────────────

	tick(_delta: number, ctx: SimulationContext): WorldPatch {
		const patch: WorldPatch = {};

		const atmospherePatch = this.#tickRandomize(_delta, ctx);
		if (atmospherePatch) patch.atmosphere = atmospherePatch;

		if (ctx.isOrbitMode) {
			const nextLoc = this.#tickDirector(_delta, ctx);
			if (nextLoc) patch.nextLocation = nextLoc;
		}

		return patch;
	}

	resetDirector(): void {
		this.#directorTimer = 0;
		this.#timeToNextLocation = randomBetween(AMBIENT.DIRECTOR_MIN_INTERVAL, AMBIENT.DIRECTOR_MAX_INTERVAL);
	}

	// ─── Weather randomisation ────────────────────────────────────────────────

	#tickRandomize(delta: number, ctx: SimulationContext): AtmospherePatch | null {
		this.#randomizeTimer += delta;
		if (this.#randomizeTimer < this.#nextRandomizeTime) return null;
		if (ctx.userAdjustingAtmosphere) return null;

		this.#randomizeTimer = 0;
		this.#nextRandomizeTime = randomBetween(AMBIENT.SUBSEQUENT_MIN_DELAY, AMBIENT.SUBSEQUENT_MAX_DELAY);

		const patch: AtmospherePatch = {};
		patch.cloudDensity = clamp(ctx.cloudDensity + (Math.random() - 0.5) * AMBIENT.CLOUD_DENSITY_SHIFT, AMBIENT.CLOUD_DENSITY_MIN, AMBIENT.CLOUD_DENSITY_MAX);
		patch.cloudSpeed   = clamp(ctx.cloudSpeed   + (Math.random() - 0.5) * AMBIENT.CLOUD_SPEED_SHIFT,   AMBIENT.CLOUD_SPEED_MIN,   AMBIENT.CLOUD_SPEED_MAX);
		patch.haze         = clamp(ctx.haze         + (Math.random() - 0.5) * AMBIENT.HAZE_SHIFT,          AMBIENT.HAZE_MIN,          AMBIENT.HAZE_MAX);

		if (Math.random() < AMBIENT.WEATHER_CHANGE_CHANCE) {
			patch.weather = pickRandom(AMBIENT.WEATHER_POOL);
		}

		return patch;
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
