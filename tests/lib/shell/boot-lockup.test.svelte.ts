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
		// Back to flight with zero fps re-covers.
		model.setDisplayMode('flight');
		flushSync();
		expect(dissolved()).toBe(false);
	});

	it('a live frame clears the latch — a later stall re-covers the view', () => {
		boot();
		vi.advanceTimersByTime(15_000); // forced dissolve, latch set
		flushSync();
		expect(dissolved()).toBe(true);

		// Rendering recovers: fps goes live.
		model.telemetry.recordFramePeriod(16.7);
		flushSync();
		expect(model.measuredFps).toBeGreaterThan(0);
		expect(dissolved()).toBe(true); // live — correctly uncovered

		// A LATER genuine stall must re-cover (the header contract), which is
		// only possible if forcedDissolve was reset on recovery.
		model.telemetry.periodMsRecent = [];
		flushSync();
		expect(model.measuredFps).toBe(0);
		expect(dissolved()).toBe(false);
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
