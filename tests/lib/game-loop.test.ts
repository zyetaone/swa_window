/**
 * Game-loop emergency reload — the thrown-exception self-healer.
 *
 * Pins: 10 consecutive subscriber failures trigger exactly ONE reload, and
 * only while the shared hourly reload budget (lifecycle-liveness) has
 * capacity; with the budget exhausted the failing subscriber is unsubscribed
 * instead of reload-looping the kiosk forever; a successful frame resets the
 * failure streak.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STORAGE_KEY } from '$lib/model/persistence';
import { tryConsumeReloadBudget } from '$lib/world/lifecycle-liveness';

// game-loop holds module-private state (subscribers, rafId), so each test
// gets a fresh module instance via resetModules + dynamic import.
let gameLoop: typeof import('$lib/game-loop');

let rafQueue: FrameRequestCallback[];
let reload: ReturnType<typeof vi.fn>;

/** Deliver one animation frame to every queued loop callback. */
function frame(now: number): void {
	const pending = rafQueue.splice(0);
	for (const cb of pending) cb(now);
}

function frames(n: number, start = 0): void {
	for (let i = 0; i < n; i++) frame(start + i * 16);
}

beforeEach(async () => {
	vi.resetModules();
	sessionStorage.clear();
	localStorage.clear();
	rafQueue = [];
	let rafSeq = 0;
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		rafQueue.push(cb);
		return ++rafSeq;
	});
	vi.stubGlobal('cancelAnimationFrame', () => {});
	reload = vi.fn();
	vi.spyOn(window.location, 'reload').mockImplementation(reload as () => void);
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	gameLoop = await import('$lib/game-loop');
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('game-loop emergency reload', () => {
	it('reloads once after 10 consecutive failures while budget is available', () => {
		localStorage.setItem(STORAGE_KEY, 'stale-config');
		const fn = vi.fn(() => {
			throw new Error('boom');
		});
		const unsub = gameLoop.subscribe(fn);

		frames(9);
		expect(reload).not.toHaveBeenCalled();

		frames(1);
		expect(fn).toHaveBeenCalledTimes(10);
		expect(reload).toHaveBeenCalledOnce();
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
		unsub();
	});

	it('unsubscribes the failing callback instead of reloading when the budget is exhausted', () => {
		// Burn the shared hourly budget (3 reloads) first.
		expect(tryConsumeReloadBudget()).toBe(true);
		expect(tryConsumeReloadBudget()).toBe(true);
		expect(tryConsumeReloadBudget()).toBe(true);

		const fn = vi.fn(() => {
			throw new Error('boom');
		});
		gameLoop.subscribe(fn);

		frames(10);
		expect(fn).toHaveBeenCalledTimes(10);
		expect(reload).not.toHaveBeenCalled();

		// The subscriber was dropped — further frames never invoke it again.
		frames(5, 160);
		expect(fn).toHaveBeenCalledTimes(10);
		expect(reload).not.toHaveBeenCalled();
		expect(console.warn).toHaveBeenCalledOnce();
	});

	it('leaves the loop restartable when the reload no-ops', () => {
		const bad = vi.fn(() => {
			throw new Error('boom');
		});
		const good = vi.fn();
		const unsubBad = gameLoop.subscribe(bad);
		gameLoop.subscribe(good);

		frames(10);
		expect(reload).toHaveBeenCalledOnce();

		// The mocked reload is a no-op: loop() returned without scheduling the
		// next frame. The failing subscriber tears down; a later subscribe must
		// restart the loop for the survivors. Before the fix rafId stayed
		// non-null, so start() early-returned and the RAF loop was dead for
		// the rest of the session.
		unsubBad();
		const late = vi.fn();
		gameLoop.subscribe(late);
		frames(1, 160);
		expect(good.mock.calls.length).toBeGreaterThan(9);
		expect(late).toHaveBeenCalledOnce();
	});

	it('a successful frame resets the failure streak', () => {
		let shouldThrow = true;
		const fn = vi.fn(() => {
			if (shouldThrow) throw new Error('boom');
		});
		const unsub = gameLoop.subscribe(fn);

		frames(9); // 9 consecutive failures — one short of the reload threshold
		expect(reload).not.toHaveBeenCalled();

		shouldThrow = false;
		frames(1, 144); // success resets the streak
		expect(reload).not.toHaveBeenCalled();

		shouldThrow = true;
		frames(9, 160); // 9 fresh failures — still no reload
		expect(reload).not.toHaveBeenCalled();

		frames(1, 304); // 10th consecutive failure — now reload
		expect(fn).toHaveBeenCalledTimes(20);
		expect(reload).toHaveBeenCalledOnce();
		unsub();
	});
});
