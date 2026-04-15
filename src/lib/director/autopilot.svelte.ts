/**
 * DirectorEngine — autopilot: weather randomisation + scheduled location changes.
 *
 * Phase 5 migration: all AMBIENT constants replaced with ctx.director.autopilot.*
 * and ctx.director.ambient.* reads.
 */

import { untrack } from 'svelte';
import { clamp, randomBetween, pickRandom } from '$lib/utils';
import type { LocationId, SimulationContext, AtmospherePatch, WorldPatch } from '$lib/types';

// Haze min/max are hardcoded bounds — not exposed in AmbientDriftConfig.
const HAZE_MIN = 0;
const HAZE_MAX = 0.2;

export class DirectorEngine {
	// ── Private timers ────────────────────────────────────────────────────────
	#randomizeTimer = 0;
	#nextRandomizeTime = 120;

	#directorTimer = 0;
	#timeToNextLocation = 140;

	// ─────────────────────────────────────────────────────────────────────────

	tick(_delta: number, ctx: SimulationContext): WorldPatch {
		const patch: WorldPatch = {};
		untrack(() => {
			// Phase 7 — followers in a multi-Pi panorama do not run the
			// randomiser or the flight director locally. The leader (solo or
			// center) broadcasts director_decision messages that followers
			// apply via the fleet client. Without this gate, three Pis would
			// each pick a different random scenario.
			if (!ctx.isLeader) return;

			const atmospherePatch = this.#tickRandomize(_delta, ctx);
			if (atmospherePatch) patch.atmosphere = atmospherePatch;

			if (ctx.isOrbitMode) {
				const nextLoc = this.#tickDirector(_delta, ctx);
				if (nextLoc) patch.nextLocation = nextLoc;
			}
		});
		return patch;
	}

	resetDirector(ctx: SimulationContext): void {
		const ap = ctx.director.autopilot;
		this.#directorTimer = 0;
		this.#timeToNextLocation = randomBetween(ap.directorMinInterval, ap.directorMaxInterval);
	}

	// ─── Weather randomisation ────────────────────────────────────────────────

	#tickRandomize(delta: number, ctx: SimulationContext): AtmospherePatch | null {
		this.#randomizeTimer += delta;
		if (this.#randomizeTimer < this.#nextRandomizeTime) return null;
		if (ctx.userAdjustingAtmosphere) return null;

		const ap = ctx.director.autopilot;
		const am = ctx.director.ambient;

		this.#randomizeTimer = 0;
		this.#nextRandomizeTime = randomBetween(ap.subsequentMinDelay, ap.subsequentMaxDelay);

		const patch: AtmospherePatch = {};
		patch.cloudDensity = clamp(
			ctx.cloudDensity + (Math.random() - 0.5) * am.cloudDensityShift,
			am.cloudDensityMin, am.cloudDensityMax
		);
		patch.cloudSpeed = clamp(
			ctx.cloudSpeed + (Math.random() - 0.5) * am.cloudSpeedShift,
			am.cloudSpeedMin, am.cloudSpeedMax
		);
		patch.haze = clamp(
			ctx.haze + (Math.random() - 0.5) * am.hazeShift,
			HAZE_MIN, HAZE_MAX
		);

		if (Math.random() < ap.weatherChangeChance) {
			patch.weather = pickRandom(ap.weatherPool);
		}

		return patch;
	}

	// ─── Auto-pilot director ──────────────────────────────────────────────────

	#tickDirector(delta: number, ctx: SimulationContext): LocationId | null {
		if (ctx.userAdjustingAltitude || ctx.userAdjustingTime) { this.#directorTimer = 0; return null; }

		this.#directorTimer += delta;
		if (this.#directorTimer > this.#timeToNextLocation) {
			this.#directorTimer = 0;
			this.#timeToNextLocation = randomBetween(
				ctx.director.autopilot.directorMinInterval,
				ctx.director.autopilot.directorMaxInterval
			);
			return ctx.pickNextLocation!();
		}
		return null;
	}
}
