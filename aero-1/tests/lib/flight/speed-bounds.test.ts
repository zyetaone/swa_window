/**
 * The cruise-speed knob and its clamp have to agree.
 *
 * They did not. DEFAULT_FLIGHT_SPEED was 4.0 while config.camera.cruise.maxSpeed
 * was 3.0, and the two are only compared at the moment someone SETS a speed:
 * the initial `$state(DEFAULT_FLIGHT_SPEED)` is never clamped, so the model
 * boots at 4.0 and looks correct. The first admin slider drag, fleet PATCH or
 * scene push then clamps it to 3.0 — permanently, and only on the panes that
 * received it.
 *
 * That is worse than a slow plane. DEFAULT_FLIGHT_SPEED is ALSO the reference
 * that scenario playback normalises against (speedNorm = flightSpeed / DEFAULT),
 * so a clamped knob puts speedNorm at 0.75 and runs every authored leg 25%
 * slow — the same class of bug as the 4x-fast playback that the normalisation
 * was introduced to fix.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_FLIGHT_SPEED } from '$lib/flight/flight.svelte';
import { AeroWindow } from '$lib/model/aero-window.svelte';
import { CRUISE_SPEED_DEFAULTS, camera } from '$lib/model/config-tree.svelte';

describe('cruise speed bounds', () => {
	it('shares one literal source between config-tree, flight engine, and admin', () => {
		expect(DEFAULT_FLIGHT_SPEED).toBe(CRUISE_SPEED_DEFAULTS.defaultSpeed);
		expect(camera.cruise.defaultSpeed).toBe(CRUISE_SPEED_DEFAULTS.defaultSpeed);
		expect(camera.cruise.minSpeed).toBe(CRUISE_SPEED_DEFAULTS.minSpeed);
		expect(camera.cruise.maxSpeed).toBe(CRUISE_SPEED_DEFAULTS.maxSpeed);
	});

	it('can actually hold its own default', () => {
		const model = new AeroWindow();
		const { minSpeed, maxSpeed } = model.config.camera.cruise;
		expect(DEFAULT_FLIGHT_SPEED).toBeGreaterThanOrEqual(minSpeed);
		expect(DEFAULT_FLIGHT_SPEED).toBeLessThanOrEqual(maxSpeed);
	});

	it('does not silently slow the plane the first time a speed is set', () => {
		// The observable form of the bug: re-applying the value the model
		// already holds must be a no-op, not a demotion.
		const model = new AeroWindow();
		const before = model.flight.flightSpeed;
		model.setFlightSpeed(before);
		expect(model.flight.flightSpeed).toBe(before);
	});

	it('keeps authored scenario pacing at 1.0 with the knob untouched', () => {
		// speedNorm = flightSpeed / DEFAULT_FLIGHT_SPEED. Anything but 1.0 here
		// means authored waypoint durations no longer mean seconds.
		const model = new AeroWindow();
		model.setFlightSpeed(DEFAULT_FLIGHT_SPEED);
		expect(model.flight.flightSpeed / DEFAULT_FLIGHT_SPEED).toBe(1);
	});
});
