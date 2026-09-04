/**
 * A bounded, non-overlapping poller.
 *
 * WHY THIS IS SHARED, having previously been judged not worth sharing.
 *
 * The two pollers in this codebase looked like they only had a `setInterval`
 * in common — one conditions on an ETag, the other recomputes a hysteresis
 * band — so extracting the shell looked like an abstraction with two callers.
 * That reading missed the thing they actually share, which is a BUG:
 *
 *   `fetch()` has no default timeout.
 *
 * `wall-poll` guards against overlap with an `inFlight` flag it clears in a
 * `finally`. A `finally` on a promise that never settles never runs — so one
 * hung request latched the guard and that pane stopped receiving wall pushes
 * for the life of the page, silently, with the display still flying. Verified:
 * three `poll()` calls after a hung fetch produce exactly one invocation.
 * `thermal-poll` has no guard, so it cannot latch, and instead stacks requests
 * against a dead peer forever.
 *
 * This is reachable, not theoretical: the wall origin is another Pi on a venue
 * LAN. A peer losing power mid-response, or a switch dropping the path, leaves
 * a socket open with no RST and no error.
 *
 * So the shared concern is not "an interval" — it is "a request that is
 * guaranteed to end". `AbortSignal.timeout` is the whole fix, and putting it
 * in one place is what stops the next poller from being written without it.
 */

/** Longer than a slow Pi answering a 3 MB range request, shorter than a beat. */
export const DEFAULT_POLL_TIMEOUT_MS = 8_000;

export interface Poller {
	/** One round trip. Exposed so a test can drive it without a timer. */
	poll(): Promise<void>;
	stop(): void;
}

export interface PollOptions {
	/** Milliseconds between attempts. */
	intervalMs: number;
	/** Abort a request that has not settled by here. */
	timeoutMs?: number;
	/**
	 * Run one attempt immediately on creation.
	 *
	 * Off by default, and `wall-poll` keeps it off deliberately: its caller
	 * makes the first call so a fire-and-forget one here cannot hold the
	 * overlap guard against it.
	 */
	immediate?: boolean;
}

/**
 * Wrap `attempt` in an interval, an overlap guard and a timeout.
 *
 * `attempt` receives an `AbortSignal` it MUST pass to its fetch — that is the
 * whole point of this module, and the reason the signal is a parameter rather
 * than something applied for the caller: a fetch that ignores it is a bug this
 * cannot fix, and making it explicit is what makes it reviewable.
 *
 * Errors are swallowed by design. A pane that cannot reach a peer keeps
 * running on what it has; surfacing this would put a network error on a kiosk
 * screen in a client's lobby, and every caller here has a documented
 * stay-as-you-are fallback.
 */
export function createPoller(
	attempt: (signal: AbortSignal) => Promise<void>,
	{ intervalMs, timeoutMs = DEFAULT_POLL_TIMEOUT_MS, immediate = false }: PollOptions
): Poller {
	let stopped = false;
	/**
	 * The in-flight attempt, or null. A PROMISE rather than a boolean, so an
	 * overlapping `poll()` can await the work already running instead of
	 * returning as though it had done some.
	 *
	 * That distinction is load-bearing for every caller and every test: `await
	 * poller.poll()` has to mean "a round trip has completed", or a test that
	 * polls and then asserts is racing the interval. The boolean version made
	 * it mean "a round trip has completed, UNLESS one happened to be running,
	 * in which case nothing" — which is exactly the kind of conditional
	 * contract that reads fine and fails intermittently.
	 */
	let inFlight: Promise<void> | null = null;

	function poll(): Promise<void> {
		if (stopped) return Promise.resolve();
		if (inFlight) return inFlight;

		// Created per attempt: a timeout signal fires once and cannot be reused.
		const ac = AbortSignal.timeout(timeoutMs);
		const run = (async () => {
			try {
				await attempt(ac);
			} catch {
				/* Offline, aborted, malformed: the caller's fallback is to stay put. */
			} finally {
				// Reached even on abort, because the abort REJECTS the fetch promise.
				// That rejection is the mechanism that unlatches the guard.
				inFlight = null;
			}
		})();
		inFlight = run;
		return run;
	}

	const id = setInterval(poll, intervalMs);
	if (immediate) void poll();

	return {
		poll,
		stop() {
			stopped = true;
			clearInterval(id);
		}
	};
}
