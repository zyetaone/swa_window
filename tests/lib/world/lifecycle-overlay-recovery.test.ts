/**
 * Overlay recovery — the too-slow-but-alive self-preserver.
 *
 * Pins: sustained low fps disables the overlay AND persists the decision;
 * a healthy check resets the slow streak; the persisted flag survives until
 * an explicit re-enable (SidePanel toggle / ?overlay=1) clears it; an
 * explicit ?overlay= URL param is detectable so the boot-time check in
 * GlobeLayer can refuse to clobber it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	startOverlayRecovery,
	isOverlayPersistentlyDisabled,
	clearOverlayDisabled,
	hasExplicitOverlayParam,
} from '$lib/world/lifecycle-overlay-recovery';

beforeEach(() => {
	vi.useFakeTimers();
	localStorage.clear();
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	history.replaceState(null, '', '/');
});

function run(opts: { fps: number[]; intervalMs?: number; slowChecksRequired?: number }) {
	const disableOverlay = vi.fn();
	let i = 0;
	const stop = startOverlayRecovery({
		getFps: () => opts.fps[Math.min(i++, opts.fps.length - 1)],
		disableOverlay,
		intervalMs: opts.intervalMs ?? 1000,
		slowChecksRequired: opts.slowChecksRequired ?? 3,
	});
	return { disableOverlay, stop };
}

describe('overlay recovery', () => {
	it('never disables while fps is healthy', () => {
		const { disableOverlay, stop } = run({ fps: [60, 60, 60, 60] });
		vi.advanceTimersByTime(4000);
		expect(disableOverlay).not.toHaveBeenCalled();
		expect(isOverlayPersistentlyDisabled()).toBe(false);
		stop();
	});

	it('disables AND persists after 3 consecutive slow checks', () => {
		expect(isOverlayPersistentlyDisabled()).toBe(false);
		const { disableOverlay, stop } = run({ fps: [3, 3, 3, 3] });
		vi.advanceTimersByTime(2000);
		expect(disableOverlay).not.toHaveBeenCalled(); // 2 slow — not yet
		vi.advanceTimersByTime(1000);
		expect(disableOverlay).toHaveBeenCalledOnce(); // 3rd consecutive — disable
		expect(isOverlayPersistentlyDisabled()).toBe(true); // survives reboot
		stop();
	});

	it('a healthy check resets the slow streak', () => {
		const { disableOverlay, stop } = run({ fps: [3, 3, 60, 3, 3, 60] });
		vi.advanceTimersByTime(6000);
		expect(disableOverlay).not.toHaveBeenCalled(); // never 3 consecutive
		expect(isOverlayPersistentlyDisabled()).toBe(false);
		stop();
	});

	it('fps <= 0 is the liveness watchdog\'s job, not this one', () => {
		const { disableOverlay, stop } = run({ fps: [3, 0, 0, 0, 3, 3] });
		vi.advanceTimersByTime(6000);
		expect(disableOverlay).toHaveBeenCalledOnce(); // dead checks don't break the streak
		stop();
	});

	it('clearOverlayDisabled lifts the persisted flag (explicit re-enable)', () => {
		const { stop } = run({ fps: [3, 3, 3] });
		vi.advanceTimersByTime(3000);
		expect(isOverlayPersistentlyDisabled()).toBe(true);
		clearOverlayDisabled();
		expect(isOverlayPersistentlyDisabled()).toBe(false);
		stop();
	});
});

describe('hasExplicitOverlayParam', () => {
	it('is false with no overlay param', () => {
		history.replaceState(null, '', '/?location=dubai');
		expect(hasExplicitOverlayParam()).toBe(false);
	});

	it('is true for ?overlay=1 (perf-gate force-on)', () => {
		history.replaceState(null, '', '/?overlay=1');
		expect(hasExplicitOverlayParam()).toBe(true);
	});

	it('is true for ?overlay=0 too — the explicit escape hatch must not be clobbered either', () => {
		history.replaceState(null, '', '/?overlay=0');
		expect(hasExplicitOverlayParam()).toBe(true);
	});
});
