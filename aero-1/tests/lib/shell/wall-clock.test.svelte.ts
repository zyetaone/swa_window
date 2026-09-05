/**
 * wall-clock — one shared, reference-counted tick for every clock in the app.
 *
 * The bug this replaces: three private intervals (BlindInfoCard at 30 s, admin
 * at 1 s, and the new CabinClock), which meant two clocks on the same kiosk
 * could show different minutes for up to 30 s. Reference counting is the part
 * worth pinning — a hidden clock must cost nothing on a Pi 5.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	subscribeWallClock,
	wallClockNow,
	wallClockIsRunning,
	wallClockSubscriberCount,
	formatClock,
	formatClockDate,
} from '$lib/shell/passenger/wall-clock.svelte';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('wall-clock lifecycle', () => {
	it('starts no timer until someone subscribes', () => {
		expect(wallClockIsRunning()).toBe(false);
		expect(wallClockSubscriberCount()).toBe(0);
	});

	it('runs ONE timer no matter how many consumers subscribe', () => {
		const a = subscribeWallClock();
		const b = subscribeWallClock();
		const c = subscribeWallClock();
		expect(wallClockIsRunning()).toBe(true);
		expect(wallClockSubscriberCount()).toBe(3);
		a(); b(); c();
	});

	it('keeps ticking while ANY consumer remains, stops at the last one', () => {
		const a = subscribeWallClock();
		const b = subscribeWallClock();

		a();
		expect(wallClockIsRunning()).toBe(true);   // b still needs it
		expect(wallClockSubscriberCount()).toBe(1);

		b();
		expect(wallClockIsRunning()).toBe(false);  // nothing left — no idle timer
		expect(wallClockSubscriberCount()).toBe(0);
	});

	it('advances the shared value once per second', () => {
		const stop = subscribeWallClock();
		const t0 = wallClockNow();
		vi.advanceTimersByTime(3000);
		expect(wallClockNow()).toBeGreaterThanOrEqual(t0 + 3000);
		stop();
	});

	it('a double teardown cannot drive the count negative', () => {
		const stop = subscribeWallClock();
		stop();
		stop();                                    // defensive: unmount races
		expect(wallClockSubscriberCount()).toBe(0);
		expect(wallClockIsRunning()).toBe(false);

		// And the clock still works afterwards.
		const again = subscribeWallClock();
		expect(wallClockIsRunning()).toBe(true);
		again();
	});

	it('re-subscribing after a full stop restarts the timer', () => {
		subscribeWallClock()();
		expect(wallClockIsRunning()).toBe(false);
		const stop = subscribeWallClock();
		expect(wallClockIsRunning()).toBe(true);
		stop();
	});
});

describe('clock formatting', () => {
	// Fixed instant: 2026-08-04T09:07:03 local.
	const t = new Date(2026, 7, 4, 9, 7, 3).getTime();

	it('pads to HH:MM in 24-hour form', () => {
		expect(formatClock(t)).toBe('09:07');
	});

	it('adds seconds only when asked', () => {
		expect(formatClock(t, true)).toBe('09:07:03');
	});

	it('uses 24-hour time (departure-board convention, no AM/PM)', () => {
		const evening = new Date(2026, 7, 4, 21, 5, 0).getTime();
		expect(formatClock(evening)).toBe('21:05');
		expect(formatClock(evening)).not.toMatch(/[ap]m/i);
	});

	it('renders midnight as 00:00, not 24:00 or 12:00', () => {
		expect(formatClock(new Date(2026, 7, 4, 0, 0, 0).getTime())).toBe('00:00');
	});

	it('formats a short date line', () => {
		const d = formatClockDate(t);
		expect(d).toMatch(/Aug/);
		expect(d).toMatch(/4/);
	});
});
