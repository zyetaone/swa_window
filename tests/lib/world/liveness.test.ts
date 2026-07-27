/**
 * Liveness watchdog — the frozen-but-alive self-healer.
 *
 * Pins: no reload while healthy; reload only after N CONSECUTIVE dead
 * checks; a healthy check resets the streak; the hourly reload budget is
 * consumed atomically and caps at 3 (a hard fault must not strobe the
 * display with reload loops); hidden tabs never count as dead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	startLivenessWatchdog,
	tryConsumeReloadBudget,
	reloadBudgetAvailable,
} from '$lib/world/liveness';

beforeEach(() => {
	vi.useFakeTimers();
	sessionStorage.clear();
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

function run(opts: { fps: number[]; intervalMs?: number }) {
	const reload = vi.fn();
	const events: unknown[] = [];
	let i = 0;
	const stop = startLivenessWatchdog({
		getFps: () => opts.fps[Math.min(i++, opts.fps.length - 1)],
		recordEvent: (_k, p) => events.push(p),
		intervalMs: opts.intervalMs ?? 1000,
		reload,
	});
	return { reload, events, stop };
}

describe('liveness watchdog', () => {
	it('never reloads while fps is healthy', () => {
		const { reload, stop } = run({ fps: [60, 60, 60, 60] });
		vi.advanceTimersByTime(4000);
		expect(reload).not.toHaveBeenCalled();
		stop();
	});

	it('reloads after 2 consecutive dead checks', () => {
		const { reload, stop } = run({ fps: [0, 0, 0] });
		vi.advanceTimersByTime(1000);
		expect(reload).not.toHaveBeenCalled();  // first dead check — not yet
		vi.advanceTimersByTime(1000);
		expect(reload).toHaveBeenCalledOnce();  // second consecutive — reload
		stop();
	});

	it('a healthy check resets the dead streak', () => {
		const { reload, stop } = run({ fps: [0, 60, 0, 60, 0, 60] });
		vi.advanceTimersByTime(6000);
		expect(reload).not.toHaveBeenCalled();  // never 2 consecutive
		stop();
	});

	it('reload budget caps at 3 per hour and is consumed atomically', () => {
		expect(tryConsumeReloadBudget()).toBe(true);
		expect(tryConsumeReloadBudget()).toBe(true);
		expect(tryConsumeReloadBudget()).toBe(true);
		expect(tryConsumeReloadBudget()).toBe(false);   // 4th within the hour — denied
		expect(reloadBudgetAvailable()).toBe(false);
	});

	it('budget entries expire after an hour', () => {
		const t0 = Date.now();
		expect(tryConsumeReloadBudget(t0)).toBe(true);
		expect(tryConsumeReloadBudget(t0)).toBe(true);
		expect(tryConsumeReloadBudget(t0)).toBe(true);
		expect(reloadBudgetAvailable(t0)).toBe(false);
		expect(reloadBudgetAvailable(t0 + 3_600_001)).toBe(true);   // rolled off
	});

	it('watchdog stops reloading once the budget is exhausted', () => {
		// Exhaust the budget first.
		tryConsumeReloadBudget();
		tryConsumeReloadBudget();
		tryConsumeReloadBudget();
		const { reload, events, stop } = run({ fps: [0, 0, 0, 0] });
		vi.advanceTimersByTime(4000);
		expect(reload).not.toHaveBeenCalled();
		expect(events.some((e) => (e as { reloadBudgetExhausted?: boolean }).reloadBudgetExhausted)).toBe(true);
		stop();
	});
});
