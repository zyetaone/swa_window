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
	attachCanvasLiveness,
} from '$lib/world/lifecycle-liveness';

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
	});

	it('budget entries expire after an hour', () => {
		const t0 = Date.now();
		expect(tryConsumeReloadBudget(t0)).toBe(true);
		expect(tryConsumeReloadBudget(t0)).toBe(true);
		expect(tryConsumeReloadBudget(t0)).toBe(true);
		expect(tryConsumeReloadBudget(t0)).toBe(false);              // capped
		expect(tryConsumeReloadBudget(t0 + 3_600_001)).toBe(true);   // rolled off
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

	it('budget-exhausted latch: the terminal event logs ONCE, then silence', () => {
		tryConsumeReloadBudget();
		tryConsumeReloadBudget();
		tryConsumeReloadBudget();
		const { reload, events, stop } = run({ fps: [0, 0, 0, 0, 0, 0, 0, 0] });
		vi.advanceTimersByTime(8000);
		expect(reload).not.toHaveBeenCalled();
		// Before the latch this was 3 error events per 2 intervals, forever.
		// Now: 2 dead-check events + 1 terminal event, then quiet.
		expect(events).toHaveLength(3);
		expect(
			events.filter((e) => (e as { reloadBudgetExhausted?: boolean }).reloadBudgetExhausted),
		).toHaveLength(1);
		stop();
	});

	it('a healthy check resets the latch — a later stall reports again', () => {
		tryConsumeReloadBudget();
		tryConsumeReloadBudget();
		tryConsumeReloadBudget();
		// stall → terminal latch → recover → stall again → reports again.
		const { events, stop } = run({ fps: [0, 0, 0, 60, 0, 0, 0] });
		vi.advanceTimersByTime(7000);
		expect(
			events.filter((e) => (e as { reloadBudgetExhausted?: boolean }).reloadBudgetExhausted),
		).toHaveLength(2);
		stop();
	});
	// Regression: a canvas left registered after its owner unmounts keeps
	// reporting a LOST context forever, so the watchdog sees "dead" on every
	// check and burns the hourly reload budget trying to recover a canvas that
	// no longer exists. ThreeOverlay used to discard this unregister handle.
	it('unregistering a canvas stops its dead context from forcing reloads', () => {
		// A canvas whose WebGL context is permanently lost — i.e. an orphan
		// left behind by a remount.
		const orphan = {
			getContext: () => ({ isContextLost: () => true }),
			addEventListener() {},
			removeEventListener() {},
		} as unknown as HTMLCanvasElement;

		const unregister = attachCanvasLiveness(orphan, 'test', { recordEvent() {} });

		// While registered, healthy fps is not enough: the lost context alone
		// marks the app dead, so the watchdog reloads.
		const a = run({ fps: [60, 60, 60] });
		vi.advanceTimersByTime(2000);
		expect(a.reload).toHaveBeenCalled();
		a.stop();

		// After the owner unmounts and unregisters, the same healthy fps is
		// correctly read as alive.
		unregister();
		sessionStorage.clear();
		const b = run({ fps: [60, 60, 60] });
		vi.advanceTimersByTime(3000);
		expect(b.reload).not.toHaveBeenCalled();
		b.stop();
	});
});

describe('attachCanvasLiveness', () => {
	// Fake canvas: records listeners and reports a lost context on demand.
	function fakeCanvas(lost = false) {
		const listeners = new Map<string, EventListener[]>();
		return {
			lost,
			listeners,
			addEventListener(t: string, fn: EventListener) {
				listeners.set(t, [...(listeners.get(t) ?? []), fn]);
			},
			removeEventListener(t: string, fn: EventListener) {
				listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== fn));
			},
			getContext() {
				return { isContextLost: () => (this as { lost: boolean }).lost };
			},
			fire() {
				for (const fn of listeners.get('webglcontextlost') ?? []) {
					fn({ preventDefault() {} } as unknown as Event);
				}
			},
		};
	}

	function reporter() {
		const seen: Record<string, unknown>[] = [];
		return { seen, recordEvent: (_k: 'error', d: Record<string, unknown>) => seen.push(d) };
	}

	it('reports a context loss with its origin', () => {
		const canvas = fakeCanvas();
		const tel = reporter();
		attachCanvasLiveness(canvas as unknown as HTMLCanvasElement, 'cesium', tel);
		canvas.fire();
		expect(tel.seen).toEqual([{ where: 'cesium', event: 'webglcontextlost' }]);
	});

	it('teardown removes the listener AND the watchdog registration', () => {
		const canvas = fakeCanvas(true); // context already lost
		const tel = reporter();
		const detach = attachCanvasLiveness(canvas as unknown as HTMLCanvasElement, 'cesium', tel);

		// While registered, the watchdog sees the dead context.
		const before = run({ fps: [60] });
		vi.advanceTimersByTime(31_000);
		before.stop();
		expect(before.reload).toHaveBeenCalled();

		detach();
		canvas.fire();
		expect(tel.seen).toHaveLength(0); // listener gone

		// Unregistered, the dead canvas no longer triggers recovery.
		sessionStorage.clear();
		const after = run({ fps: [60] });
		vi.advanceTimersByTime(31_000);
		after.stop();
		expect(after.reload).not.toHaveBeenCalled();
	});

	it('releases the PREVIOUS canvas when a renderer is re-created', () => {
		// This is the drift the two hand-written copies had: only the Three one
		// released first, so a retried Cesium viewer could orphan its old canvas
		// in the watchdog set and poll a dead context forever.
		const tel = reporter();
		const first = fakeCanvas(true); // the canvas that died
		const second = fakeCanvas(false); // healthy replacement from auto-retry

		let detach = attachCanvasLiveness(first as unknown as HTMLCanvasElement, 'cesium', tel);
		detach = attachCanvasLiveness(second as unknown as HTMLCanvasElement, 'cesium', tel, detach);

		const r = run({ fps: [60] });
		vi.advanceTimersByTime(31_000);
		r.stop();
		expect(r.reload).not.toHaveBeenCalled(); // dead canvas was released
		detach();
	});
});
