/**
 * BootLockup — the held first frame, mounted for real.
 *
 * Pins the not-latched contract from the component header: the 15s safety
 * dissolve must NOT be permanent. A live frame clears the latch so a LATER
 * genuine stall re-covers the view (the audience sees the splash, not a
 * frozen globe); while the latch is held, a stalled renderer must not
 * re-arm the timer or log duplicate error events.
 *
 * fps is driven through model.telemetry: recordFramePeriod() makes it live;
 * resetting the public periodMsRecent buffer drops it back to 0 (a stall).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import type { AeroWindow } from '$lib/model/aero-window.svelte';
import BootLockupMount from '../../fixtures/BootLockupMount.svelte';

let app: Record<string, unknown> | null = null;
let model: AeroWindow;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.clearAllTimers();
	vi.useRealTimers();
});

function boot() {
	app = mount(BootLockupMount, {
		target: document.body,
		props: { onprovide: (m: AeroWindow) => (model = m) },
	});
	flushSync();
}

const lockup = () => document.querySelector('.boot-lockup');
const dissolved = () => lockup()?.classList.contains('dissolved') ?? false;
const errorEvents = () =>
	model.telemetry.events.filter(
		(e) => e.kind === 'error' && (e.payload as { where?: string }).where === 'boot-lockup',
	);

describe('BootLockup', () => {
	it('covers the view until the 15s safety timeout, then dissolves and logs once', () => {
		boot();
		expect(dissolved()).toBe(false);

		vi.advanceTimersByTime(14_999);
		expect(dissolved()).toBe(false);
		expect(errorEvents()).toHaveLength(0);

		vi.advanceTimersByTime(1);
		flushSync();
		expect(dissolved()).toBe(true);
		expect(errorEvents()).toHaveLength(1);
	});

	it('does not re-log while still stalled after the forced dissolve', () => {
		boot();
		vi.advanceTimersByTime(15_000);
		flushSync();
		expect(errorEvents()).toHaveLength(1);

		// Still dead an hour later — the latch must not re-arm/re-log.
		vi.advanceTimersByTime(3_600_000);
		flushSync();
		expect(errorEvents()).toHaveLength(1);
	});

	it('media mode dissolves without waiting for Cesium fps', () => {
		boot();
		expect(dissolved()).toBe(false);
		// No frame periods — still covers in flight mode.
		expect(model.measuredFps).toBe(0);
		model.setDisplayMode('video', 'https://cdn.example.com/a.mp4');
		flushSync();
		expect(dissolved()).toBe(true);
		// Back to flight with zero fps re-covers — but only after the stall
		// grace period, not on the first zero sample (see below).
		model.setDisplayMode('flight');
		flushSync();
		expect(dissolved()).toBe(true);
		vi.advanceTimersByTime(5_000);
		flushSync();
		expect(dissolved()).toBe(false);
	});

	it('a momentary zero-fps sample does NOT re-cover the view', () => {
		// The reported cold-boot symptom: the wall started, stopped, then
		// started again. The Pi panel genuinely runs at 2-4 fps, so one tile
		// decode or GC pause makes the median frame period read as zero for a
		// sample — and the splash slammed back over a healthy scene. Covering
		// on a sustained stall is right; covering on one sample is the bug.
		boot();
		model.telemetry.recordFramePeriod(16.7);
		flushSync();
		expect(dissolved()).toBe(true);

		model.telemetry.periodMsRecent = [];
		flushSync();
		expect(model.measuredFps).toBe(0);
		// Still uncovered: a blip must not slam the splash back.
		expect(dissolved()).toBe(true);

		// And a frame arriving inside the grace window cancels it outright.
		vi.advanceTimersByTime(4_000);
		model.telemetry.recordFramePeriod(16.7);
		flushSync();
		vi.advanceTimersByTime(10_000);
		flushSync();
		expect(dissolved()).toBe(true);
	});

	it('a SUSTAINED stall still re-covers — the safety property is delayed, not removed', () => {
		boot();
		model.telemetry.recordFramePeriod(16.7);
		flushSync();
		expect(dissolved()).toBe(true);

		// Renderer dies and stays dead.
		model.telemetry.periodMsRecent = [];
		flushSync();
		vi.advanceTimersByTime(5_000);
		flushSync();
		expect(model.measuredFps).toBe(0);
		expect(dissolved()).toBe(false); // covered again — audience sees the
		                                 // splash, never a frozen globe
	});

	it('a re-covered stall that persists 15s reports again (new fault, not a duplicate)', () => {
		boot();
		vi.advanceTimersByTime(15_000);
		flushSync();
		model.telemetry.recordFramePeriod(16.7); // recover
		flushSync();
		model.telemetry.periodMsRecent = []; // stall again
		flushSync();

		vi.advanceTimersByTime(15_000);
		flushSync();
		expect(dissolved()).toBe(true);
		expect(errorEvents()).toHaveLength(2);
	});
});
