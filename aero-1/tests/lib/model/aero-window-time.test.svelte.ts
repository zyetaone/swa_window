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
import { applyConfigPatch } from '$lib/model/config-tree.svelte';

beforeEach(() => {
	localStorage.clear();
	// director.daylight.timeZoneOverride is process-global config — clear so
	// tests that set an override cannot poison later cases.
	applyConfigPatch('director.daylight.timeZoneOverride', '');
});

afterEach(() => {
	vi.useRealTimers();
	applyConfigPatch('director.daylight.timeZoneOverride', '');
});

describe('updateTimeFromSystem', () => {
	it('computes location-local time via IANA zone (Dubai, no DST)', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T10:30:00Z'));
		const model = new AeroWindow();
		model.syncToRealTime = false; // isolate explicit update call
		model.setLocation('dubai');   // Asia/Dubai = UTC+4
		model.updateTimeFromSystem();
		expect(model.timeOfDay).toBeCloseTo(14.5, 5);
	});

	it('applies DST for Dallas (America/Chicago CDT in August)', () => {
		vi.useFakeTimers();
		// 10:30 UTC → 05:30 CDT (UTC−5), not the fixed utcOffset −6
		vi.setSystemTime(new Date('2026-08-14T10:30:00Z'));
		const model = new AeroWindow();
		model.syncToRealTime = false;
		model.setLocation('dallas');
		model.updateTimeFromSystem();
		expect(model.timeOfDay).toBeCloseTo(5.5, 5);
	});

	it('honours director.daylight.timeZoneOverride over location zone', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T10:30:00Z'));
		const model = new AeroWindow();
		model.syncToRealTime = false;
		model.setLocation('dallas');
		model.applyConfigPatch('director.daylight.timeZoneOverride', 'UTC');
		model.updateTimeFromSystem();
		expect(model.timeOfDay).toBeCloseTo(10.5, 5);
	});

	it('computes location-local time for Pacific/Honolulu (no DST)', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T10:30:00Z'));
		const model = new AeroWindow();
		model.syncToRealTime = false;
		model.setLocation('ocean');   // Pacific/Honolulu = UTC−10
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

describe('wall-clock tick context', () => {
	// Regression: wallDeltaSec was upper-capped (5 s) but never floored, so a
	// runtime NTP step-BACK produced e.g. -3600 and slammed the orbit/scenario
	// integrators far backward. Now clamped to [0, 5].
	it('floors wallDeltaSec at 0 when the system clock steps backward', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T10:30:00Z'));
		const model = new AeroWindow();
		model.syncToRealTime = false;
		const spy = vi.spyOn(model.flight, 'tick');
		model.tick(0.016); // establishes the wall-clock baseline
		vi.setSystemTime(new Date('2026-08-14T09:30:00Z')); // 1 h NTP step-back
		model.tick(0.016);
		expect(spy.mock.calls[1][1].wallDeltaSec).toBe(0);
	});

	it('caps wallDeltaSec at 5 s after a long suspend', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T10:30:00Z'));
		const model = new AeroWindow();
		model.syncToRealTime = false;
		const spy = vi.spyOn(model.flight, 'tick');
		model.tick(0.016);
		vi.setSystemTime(new Date('2026-08-14T10:32:00Z')); // 2 min suspend
		model.tick(0.016);
		expect(spy.mock.calls[1][1].wallDeltaSec).toBe(5);
	});
});
