import { describe, it, expect } from 'vitest';
import { createPoller, DEFAULT_POLL_TIMEOUT_MS } from '#lib/poll.js';

/**
 * THE BUG THIS MODULE EXISTS FOR. `fetch()` has no default timeout.
 *
 * `wall-poll` guarded overlap with an `inFlight` boolean cleared in a
 * `finally` — and a `finally` on a promise that never settles never runs. One
 * hung request latched the guard, and that pane stopped receiving wall pushes
 * for the life of the page, silently, while the display kept flying. Measured
 * before the fix: three `poll()` calls after a hung fetch produced exactly one
 * invocation, forever.
 *
 * Reachable, not theoretical: the wall origin is another Pi on a venue LAN, and
 * a peer losing power mid-response leaves a socket open with no RST.
 */
describe('createPoller bounds every request', () => {
	/**
	 * REAL timers, short waits. `AbortSignal.timeout` schedules on an internal
	 * timer that vitest's fake clock does not patch, so `advanceTimersByTime`
	 * never fires the abort and the test fails against correct code — which is
	 * how this was first written and is worth not repeating.
	 */
	it('recovers after a fetch that never settles', async () => {
		{
			let started = 0;
			const poller = createPoller(
				(signal) => {
					started++;
					// Never resolves on its own — only the abort can end it.
					return new Promise<void>((_res, rej) => {
						signal.addEventListener('abort', () => rej(new Error('aborted')));
					});
				},
				{ intervalMs: 10_000, timeoutMs: 50 }
			);

			void poller.poll();
			expect(started).toBe(1);

			// Still in flight: an overlapping call must not start a second request.
			void poller.poll();
			expect(started).toBe(1);

			// Past the timeout, the abort rejects the attempt and unlatches.
			await new Promise((r) => setTimeout(r, 120));
			void poller.poll();
			expect(started, 'the guard never cleared — polling is dead').toBe(2);

			poller.stop();
		}
	});

	it('hands the attempt a signal that actually aborts', async () => {
		{
			let aborted = false;
			const poller = createPoller(
				(signal) =>
					new Promise<void>((_r, rej) => {
						signal.addEventListener('abort', () => {
							aborted = true;
							rej(new Error('aborted'));
						});
					}),
				{ intervalMs: 10_000, timeoutMs: 40 }
			);
			void poller.poll();
			await new Promise((r) => setTimeout(r, 110));
			expect(aborted).toBe(true);
			poller.stop();
		}
	});

	/**
	 * `await poll()` must mean "a round trip has completed", unconditionally.
	 * Returning early on overlap made it mean "…unless one was running", which
	 * is the kind of conditional contract that reads fine and fails
	 * intermittently in a test that polls and then asserts.
	 */
	it('an overlapping poll awaits the work already running', async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => (release = r));
		let done = 0;
		const poller = createPoller(
			async () => {
				await gate;
				done++;
			},
			{ intervalMs: 10_000 }
		);

		const a = poller.poll();
		const b = poller.poll();
		release();
		await Promise.all([a, b]);
		expect(done, 'the overlapping call ran a second attempt').toBe(1);
		poller.stop();
	});

	it('swallows a throwing attempt and keeps polling', async () => {
		let n = 0;
		const poller = createPoller(
			async () => {
				n++;
				throw new Error('offline');
			},
			{ intervalMs: 10_000 }
		);
		await poller.poll();
		await poller.poll();
		expect(n).toBe(2);
		poller.stop();
	});

	it('stop() ends it, and a later poll is a no-op', async () => {
		let n = 0;
		const poller = createPoller(
			async () => {
				n++;
			},
			{ intervalMs: 10_000 }
		);
		poller.stop();
		await poller.poll();
		expect(n).toBe(0);
	});

	it('immediate runs one attempt at construction, and only one', async () => {
		let n = 0;
		const poller = createPoller(
			async () => {
				n++;
			},
			{ intervalMs: 10_000, immediate: true }
		);
		await poller.poll();
		expect(n).toBe(1);
		poller.stop();
	});

	it('the default timeout is bounded and sane', () => {
		expect(DEFAULT_POLL_TIMEOUT_MS).toBeGreaterThan(1000);
		expect(DEFAULT_POLL_TIMEOUT_MS).toBeLessThan(30_000);
	});
});
