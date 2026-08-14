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
 *
 * Timers advance with wallDeltaSec (falling back to sim delta) so a slow
 * Pi (~3 fps, dt clamped at 0.1 s) still hops cities on real wall time —
 * same class of fix as orbit/scenario wall-clock integration.
 */

import { untrack } from 'svelte';
import { clamp, randomBetween, pickRandom } from '$lib/utils';
import type { LocationId, SimulationContext, VantageBeat, WorldPatch } from '$lib/types';

// ── Private timers ──────────────────────────────────────────────────────────
// Both intervals are seeded on the FIRST tick from the live config's
// initialMin/MaxDelay window (lazy init — config may not be admin-tuned by
// the time module is loaded). Earlier this pinned to a hardcoded 120 / 300
// which meant every leader booted, ticked for exactly 120s, then fired its
// first randomise event simultaneously across the fleet — a behaviour at
// odds with the "subsequentMinDelay..subsequentMaxDelay" jitter that kicks
// in on every cycle after the first.

let _randomizeTimer = 0;
let _nextRandomizeTime: number | null = null;

let _directorTimer = 0;
let _timeToNextLocation: number | null = null;

let _vantageTimer = 0;
let _timeToNextVantage: number | null = null;

/** Wall-clock step when available; otherwise sim delta (tests / legacy). */
function wallDt(delta: number, ctx: SimulationContext): number {
	const w = ctx.wallDeltaSec;
	return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : delta;
}

// ─── Tick ───────────────────────────────────────────────────────────────────

export function directorTick(delta: number, ctx: SimulationContext): WorldPatch {
	const patch: WorldPatch = {};
	untrack(() => {
		// Phase 7 — followers in a multi-Pi panorama do not run the
		// randomiser or the flight director locally. The leader (solo or
		// center) broadcasts director_decision messages that followers
		// apply via the fleet client. Without this gate, three Pis would
		// each pick a different random scenario.
		if (!ctx.isLeader || !ctx.director.autopilot.enabled) return;
		const configs = tickRandomize(delta, ctx);
		if (configs) patch.configs = configs;

		if (ctx.isOrbitMode) {
			const nextLoc = tickDirector(delta, ctx);
			if (nextLoc) {
				// A location change enters cruise mode — never fire a vantage
				// beat the same frame (the beat needs orbit). Location wins.
				patch.nextLocation = nextLoc;
			} else {
				const beat = tickVantage(delta, ctx);
				if (beat) patch.vantageBeat = beat;
			}
		}
	});
	return patch;
}

export function directorReset(ctx: SimulationContext): void {
	const ap = ctx.director.autopilot;
	_directorTimer = 0;
	_timeToNextLocation = randomBetween(ap.directorMinInterval, ap.directorMaxInterval);
	// Arriving somewhere restarts the flyover cadence — no beat right after a
	// cruise (lazy re-seed on the next tick).
	_vantageTimer = 0;
	_timeToNextVantage = null;
}

// ─── Weather randomisation ──────────────────────────────────────────────────

function tickRandomize(delta: number, ctx: SimulationContext): Array<{ path: string; value: unknown }> | null {
	const ap = ctx.director.autopilot;
	const am = ctx.director.ambient;
	const dt = wallDt(delta, ctx);

	if (_nextRandomizeTime === null) {
		_nextRandomizeTime = randomBetween(ap.initialMinDelay, ap.initialMaxDelay);
		return null;
	}
	_randomizeTimer += dt;
	if (_randomizeTimer < _nextRandomizeTime) return null;
	if (ctx.userAdjustingAtmosphere) return null;

	_randomizeTimer = 0;
	_nextRandomizeTime = randomBetween(ap.subsequentMinDelay, ap.subsequentMaxDelay);

	const configs: Array<{ path: string; value: unknown }> = [];
	configs.push({ path: 'atmosphere.clouds.density', value: clamp(
		ctx.cloudDensity + (Math.random() - 0.5) * am.cloudDensityShift,
		am.cloudDensityMin, am.cloudDensityMax,
	) });
	configs.push({ path: 'atmosphere.clouds.speed', value: clamp(
		ctx.cloudSpeed + (Math.random() - 0.5) * am.cloudSpeedShift,
		am.cloudSpeedMin, am.cloudSpeedMax,
	) });
	configs.push({ path: 'atmosphere.haze.amount', value: clamp(
		ctx.haze + (Math.random() - 0.5) * am.hazeShift,
		am.hazeMin, am.hazeMax,
	) });

	if (Math.random() < ap.weatherChangeChance) {
		configs.push({ path: 'weather', value: pickRandom(ap.weatherPool) });
	}

	return configs;
}

// ─── Auto-pilot director ────────────────────────────────────────────────────

function tickDirector(delta: number, ctx: SimulationContext): LocationId | null {
	const ap = ctx.director.autopilot;
	const dt = wallDt(delta, ctx);

	if (_timeToNextLocation === null) {
		_timeToNextLocation = randomBetween(ap.initialMinDelay, ap.initialMaxDelay);
		return null;
	}
	if (ctx.userAdjustingAltitude || ctx.userAdjustingTime) { _directorTimer = 0; return null; }

	_directorTimer += dt;
	if (_directorTimer > _timeToNextLocation) {
		_directorTimer = 0;
		_timeToNextLocation = randomBetween(ap.directorMinInterval, ap.directorMaxInterval);
		return ctx.pickNextLocation!();
	}
	return null;
}

// ─── Night-city flyover beat ─────────────────────────────────────────────────

/**
 * Occasionally chooses to descend over the lit city (leader only, orbit only).
 * Returns a VantageBeat when it fires; the leader broadcasts it and every Pi
 * enters/exits in lock-step. The beat's parameters come straight from the
 * admin-tunable `vantage` config — the roll only picks WHEN, the bounds own
 * the pitch/altitude/duration. Only fires at night (the whole point is the
 * city lights); by day the timer just idles.
 */
function tickVantage(delta: number, ctx: SimulationContext): VantageBeat | null {
	const v = ctx.director.autopilot.vantage;
	if (!v.enabled) return null;
	const dt = wallDt(delta, ctx);

	if (_timeToNextVantage === null) {
		_timeToNextVantage = randomBetween(v.minIntervalSec, v.maxIntervalSec);
		return null;
	}
	// Hold (and reset) the timer during the day or while a passenger is
	// adjusting altitude — the flyover is a night-lights moment and must
	// never fight a manual override. Resetting means the first beat waits a
	// full interval INTO the night rather than firing the instant dusk lands.
	if (ctx.nightFactor <= v.minNightFactor || ctx.userAdjustingAltitude) {
		_vantageTimer = 0;
		return null;
	}

	_vantageTimer += dt;
	if (_vantageTimer < _timeToNextVantage) return null;

	_vantageTimer = 0;
	_timeToNextVantage = randomBetween(v.minIntervalSec, v.maxIntervalSec);
	return { durationMs: v.durationSec * 1000, pitchDeg: v.pitchDeg, altitudeFt: v.altitudeFt };
}
