/**
 * Autopilot leader/follower lock-step regression coverage.
 *
 * 1. A group leader (center) that broadcasts an autopilot director_decision
 *    must schedule its OWN flyTo at the broadcast transitionAtMs — the fleet
 *    client schedules followers' applyScene at that instant, so a leader that
 *    cruises immediately reopens its blinds ~TRANSITION_DELAY_MS ahead of the
 *    edge panes.
 * 2. A solo leader has no followers: nothing is broadcast, so the autopilot
 *    flies immediately — scheduling would only add a dead 2.5 s delay. The
 *    fleet hook is deliberately still wired (production sets it for solo too,
 *    see +page.svelte) to pin that the gate is "followers exist", not "hook
 *    set".
 * 3. The autopilot's weather roll must not arm the 8 s
 *    userAdjustingAtmosphere override — that override exists to gate the
 *    randomiser while a HUMAN is adjusting, and the roll IS the randomiser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';
import { applyConfigPatch } from '$lib/model/config-tree.svelte';
import { TRANSITION_DELAY_MS } from '$lib/fleet/protocol';
import type { WeatherType } from '$lib/types';

// Shrink every autopilot cadence into tick range (model.tick rejects
// delta > 0.1, so intervals must fire within a handful of 0.1 s ticks).
const FAST = {
	'director.autopilot.initialMinDelay': 0.05,
	'director.autopilot.initialMaxDelay': 0.05,
	'director.autopilot.subsequentMinDelay': 0.05,
	'director.autopilot.subsequentMaxDelay': 0.05,
	'director.autopilot.directorMinInterval': 0.05,
	'director.autopilot.directorMaxInterval': 0.05,
} as const;

const DEFAULTS = {
	'director.autopilot.initialMinDelay': 120,
	'director.autopilot.initialMaxDelay': 300,
	'director.autopilot.subsequentMinDelay': 180,
	'director.autopilot.subsequentMaxDelay': 480,
	'director.autopilot.directorMinInterval': 240,
	'director.autopilot.directorMaxInterval': 360,
	'director.autopilot.weatherChangeChance': 0.2,
} as const;

describe('AeroWindow autopilot leader lock-step', () => {
	let model: AeroWindow;
	let broadcasts: Array<Record<string, unknown>>;

	beforeEach(() => {
		vi.useFakeTimers();
		applyConfigPatch('camera.parallax.role', 'solo');
		for (const [path, value] of Object.entries(FAST)) applyConfigPatch(path, value);
		model = new AeroWindow();
		// Pin to midday: no vantage beats, no real-time clock drift.
		model.syncToRealTime = false;
		model.timeOfDay = 12;
		broadcasts = [];
		model.setFleetBroadcast((msg) => {
			broadcasts.push(msg as Record<string, unknown>);
		});
	});

	afterEach(() => {
		model.setFleetBroadcast(null);
		model.destroy();   // cancels any pending lock-step cruise timer
		applyConfigPatch('camera.parallax.role', 'solo');
		for (const [path, value] of Object.entries(DEFAULTS)) applyConfigPatch(path, value);
		vi.useRealTimers();
	});

	it('group leader (center) schedules its own cruise at transitionAtMs, not immediately', () => {
		applyConfigPatch('camera.parallax.role', 'center');
		applyConfigPatch('director.autopilot.weatherChangeChance', 0);
		const flySpy = vi.spyOn(model.flight, 'flyTo');

		// Tick until the director fires (its timers lazy-seed on the first tick).
		let guard = 0;
		while (broadcasts.length === 0 && guard++ < 20) model.tick(0.1);

		expect(broadcasts).toHaveLength(1);
		expect(broadcasts[0].type).toBe('director_decision');
		expect(broadcasts[0].scenarioId).toBe('autopilot');
		const transitionAtMs = broadcasts[0].transitionAtMs as number;
		expect(transitionAtMs).toBeGreaterThan(Date.now());
		expect(transitionAtMs - Date.now()).toBeLessThanOrEqual(TRANSITION_DELAY_MS);

		// The leader must NOT cruise before the shared wall-clock instant.
		expect(flySpy).not.toHaveBeenCalled();
		expect(model.flight.flightMode).toBe('orbit');

		vi.advanceTimersByTime(transitionAtMs - Date.now() + 1);
		expect(flySpy).toHaveBeenCalledTimes(1);
		expect(model.flight.flightMode).not.toBe('orbit');
	});

	it('solo autopilot flies immediately — no followers, nothing broadcast', () => {
		// Role stays 'solo' with the fleet hook wired (as production does):
		// the gate is "followers exist" (center), not "hook set".
		expect(model.config.camera.parallax.role).toBe('solo');
		applyConfigPatch('director.autopilot.weatherChangeChance', 0);
		const flySpy = vi.spyOn(model.flight, 'flyTo');

		let guard = 0;
		while (flySpy.mock.calls.length === 0 && guard++ < 20) model.tick(0.1);

		expect(flySpy).toHaveBeenCalledTimes(1);   // flew inside the tick…
		expect(broadcasts).toHaveLength(0);        // …with nothing on the wire
		expect(model.flight.flightMode).not.toBe('orbit');
	});

	it('autopilot weather roll does not arm userAdjustingAtmosphere', () => {
		applyConfigPatch('director.autopilot.weatherChangeChance', 1);
		applyConfigPatch('director.autopilot.weatherPool', ['clear']);
		model.weather = 'rain' as WeatherType;   // force a visible change on the roll
		expect(model.userAdjustingAtmosphere).toBe(false);

		let guard = 0;
		while (model.weather !== 'clear' && guard++ < 20) model.tick(0.1);

		expect(model.weather).toBe('clear');            // the roll landed…
		expect(model.userAdjustingAtmosphere).toBe(false); // …without masquerading as a user
	});

	// Contrast: the HUMAN path must keep arming the override. Runs last —
	// the module-level override timestamps outlive a single test.
	it('manual setWeather still arms the user override', () => {
		model.setWeather('rain');
		expect(model.userAdjustingAtmosphere).toBe(true);
	});
});
