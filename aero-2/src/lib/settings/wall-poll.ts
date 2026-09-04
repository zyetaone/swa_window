/**
 * Polling the shared wall state.
 *
 * A poll, not a push channel. Correctness depends on applying at the second the
 * snapshot names rather than at the moment it arrives, so a bus buys latency
 * only — and it grows back the replay buffer, keep-alive and reconnection that
 * ADR-007 exists to prevent. Against a weak ETag this costs one 304 per pane
 * per interval.
 *
 * It only ever calls `sync.receive`. Applying is `advanceTo`'s alone; if this
 * module could apply, fetch latency would be an input to the pose.
 */

import type { WallSync } from './wall.svelte.js';
import type { WallSnapshot } from '#lib/wall.js';

/**
 * Two seconds against a five-second lead, so a pane has two chances to see a
 * push before the second it names.
 */
export const POLL_INTERVAL_MS = 2000;

export interface WallPoller {
	/** One round trip. Exposed so a test can drive it without a timer. */
	poll(): Promise<void>;
	stop(): void;
}

export function createWallPoller(
	sync: WallSync,
	origin = '',
	fetchImpl: typeof fetch = fetch
): WallPoller {
	let etag: string | null = null;
	let stopped = false;
	/**
	 * One request at a time. On a loaded Pi a response can outlast the interval,
	 * and overlapping polls both send the ETag the earlier one has not updated
	 * yet — so the second gets a full 200 it did not need, and they stack from
	 * there. Skipping a tick is free: the next one is two seconds away.
	 */
	let inFlight = false;

	async function poll(): Promise<void> {
		if (stopped || inFlight) return;
		inFlight = true;
		try {
			const res = await fetchImpl(`${origin}/api/wall`, {
				headers: etag ? { 'if-none-match': etag } : {}
			});
			// 304 is the expected answer almost always — nothing changed.
			if (res.status === 304 || !res.ok) return;
			etag = res.headers.get('etag');
			sync.receive((await res.json()) as WallSnapshot);
		} catch {
			// A pane that cannot reach the wall origin keeps running on what it has.
			// The alternative — surfacing this — would put a network error on a
			// kiosk screen in a client's lobby.
		} finally {
			inFlight = false;
		}
	}

	/**
	 * The interval only. The first poll is the caller's — a fire-and-forget one
	 * here would hold the in-flight guard against whoever called `poll()` next,
	 * which made the poller's own behaviour depend on how fast the first
	 * response came back.
	 */
	const id = setInterval(poll, POLL_INTERVAL_MS);

	return {
		poll,
		stop() {
			stopped = true;
			clearInterval(id);
		}
	};
}
