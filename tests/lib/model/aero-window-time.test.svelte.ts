/**
 * timeOfDay semantics — timeOfDay is LOCAL civil time at the DEPICTED
 * location, not the device's timezone. The sky pipeline assumes it
 * (computeSunDirection maps t=12 to sun-overhead; compose's #syncClock
 * converts to UTC via longitude), so "Real Time" must follow the city on
 * screen: a Hyderabad kiosk showing Dallas shows Dallas time.
 *
 * Regression: updateTimeFromSystem used device-local getHours() (only correct
 * when the kiosk TZ matched the location) and localTimeOfDay ADDED utcOffset
 * on top of it, double-counting — the HUD LOCAL readout was off by the offset
 * and the time slider snapped on every drag.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('updateTimeFromSystem', () => {
	it('computes location-local time from UTC + utcOffset (east of Greenwich)', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T10:30:00Z'));
		const model = new AeroWindow();
		model.syncToRealTime = false; // isolate explicit update call
		model.setLocation('dubai');   // utcOffset +4
		model.updateTimeFromSystem();
		expect(model.timeOfDay).toBeCloseTo(14.5, 5);
	});

	it('computes location-local time from UTC + utcOffset (west of Greenwich)', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T10:30:00Z'));
		const model = new AeroWindow();
		model.syncToRealTime = false;
		model.setLocation('ocean');   // utcOffset -10
		model.updateTimeFromSystem();
		expect(model.timeOfDay).toBeCloseTo(0.5, 5);
	});

	it('setLocation auto-syncs time when syncToRealTime is on', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T10:30:00Z'));
		const model = new AeroWindow();
		model.syncToRealTime = true;
		model.setLocation('dubai'); // +4 → 14:30 local
		expect(model.timeOfDay).toBeCloseTo(14.5, 5);
	});

	it('setLocation leaves time alone when syncToRealTime is off', () => {
		const model = new AeroWindow();
		model.syncToRealTime = false;
		model.setTime(9.25);
		model.setLocation('dubai');
		expect(model.timeOfDay).toBeCloseTo(9.25, 5);
	});

	it('localTimeOfDay is an alias for timeOfDay (no double-counted offset)', () => {
		const model = new AeroWindow();
		model.setTime(14.5);
		expect(model.localTimeOfDay).toBe(14.5);
	});
});
