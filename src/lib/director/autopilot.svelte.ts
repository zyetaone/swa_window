/**
 * Director autopilot — weather randomisation + scheduled location changes.
 *
 * Converted from DirectorEngine class to module functions: the engine had
 * zero reactive $state fields, only four private timers (plain numbers)
 * and a tick that returned a WorldPatch. A class over that is ceremony.
 *
 * AeroWindow calls directorTick() every frame (as a leader) and
 * directorReset() after cruise_transit. Timer state lives in module-local
 * `let` so it persists across ticks without consumer plumbing. There is
 * only one director in the process — no multi-instance use case exists.
 */

import { untrack } from 'svelte';
import { clamp, randomBetween, pickRandom } from '$lib/utils';
import type { LocationId, SimulationContext, AtmospherePatch, WorldPatch } from '$lib/types';

// ── Private timers ──────────────────────────────────────────────────────────

let _randomizeTimer = 0;
let _nextRandomizeTime = 120;

let _directorTimer = 0;
let _timeToNextLocation = 140;

// ─── Tick ───────────────────────────────────────────────────────────────────

export function directorTick(delta: number, ctx: SimulationContext): WorldPatch {
	const patch: WorldPatch = {};
	untrack(() => {
		// Phase 7 — followers in a multi-Pi panorama do not run the
		// randomiser or the flight director locally. The leader (solo or
		// center) broadcasts director_decision messages that followers
		// apply via the fleet client. Without this gate, three Pis would
		// each pick a different random scenario.
		if (!ctx.isLeader) return;

		const atmospherePatch = tickRandomize(delta, ctx);
		if (atmospherePatch) patch.atmosphere = atmospherePatch;

		if (ctx.isOrbitMode) {
			const nextLoc = tickDirector(delta, ctx);
			if (nextLoc) patch.nextLocation = nextLoc;
		}
	});
	return patch;
}

export function directorReset(ctx: SimulationContext): void {
	const ap = ctx.director.autopilot;
	_directorTimer = 0;
	_timeToNextLocation = randomBetween(ap.directorMinInterval, ap.directorMaxInterval);
}

// ─── Weather randomisation ──────────────────────────────────────────────────

function tickRandomize(delta: number, ctx: SimulationContext): AtmospherePatch | null {
	_randomizeTimer += delta;
	if (_randomizeTimer < _nextRandomizeTime) return null;
	if (ctx.userAdjustingAtmosphere) return null;

	const ap = ctx.director.autopilot;
	const am = ctx.director.ambient;

	_randomizeTimer = 0;
	_nextRandomizeTime = randomBetween(ap.subsequentMinDelay, ap.subsequentMaxDelay);

	const patch: AtmospherePatch = {};
	patch.cloudDensity = clamp(
		ctx.cloudDensity + (Math.random() - 0.5) * am.cloudDensityShift,
		am.cloudDensityMin, am.cloudDensityMax,
	);
	patch.cloudSpeed = clamp(
		ctx.cloudSpeed + (Math.random() - 0.5) * am.cloudSpeedShift,
		am.cloudSpeedMin, am.cloudSpeedMax,
	);
	patch.haze = clamp(
		ctx.haze + (Math.random() - 0.5) * am.hazeShift,
		am.hazeMin, am.hazeMax,
	);

	if (Math.random() < ap.weatherChangeChance) {
		patch.weather = pickRandom(ap.weatherPool);
	}

	return patch;
}

// ─── Auto-pilot director ────────────────────────────────────────────────────

function tickDirector(delta: number, ctx: SimulationContext): LocationId | null {
	if (ctx.userAdjustingAltitude || ctx.userAdjustingTime) { _directorTimer = 0; return null; }

	_directorTimer += delta;
	if (_directorTimer > _timeToNextLocation) {
		_directorTimer = 0;
		_timeToNextLocation = randomBetween(
			ctx.director.autopilot.directorMinInterval,
			ctx.director.autopilot.directorMaxInterval,
		);
		return ctx.pickNextLocation!();
	}
	return null;
}
