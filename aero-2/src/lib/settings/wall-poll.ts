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
import { createPoller, type Poller } from '#lib/poll.js';

/**
 * Two seconds against a five-second lead, so a pane has two chances to see a
 * push before the second it names.
 */
export const POLL_INTERVAL_MS = 2000;

export type WallPoller = Poller;

export function createWallPoller(
	sync: WallSync,
	origin = '',
	fetchImpl: typeof fetch = fetch
): WallPoller {
	let etag: string | null = null;

	return createPoller(
		async (signal) => {
			const res = await fetchImpl(`${origin}/api/wall`, {
				signal,
				headers: etag ? { 'if-none-match': etag } : {}
			});
			// 304 is the expected answer almost always — nothing changed.
			if (res.status === 304 || !res.ok) return;
			etag = res.headers.get('etag');
			sync.receive((await res.json()) as WallSnapshot);
		},
		{
			intervalMs: POLL_INTERVAL_MS,
			/**
			 * The first poll is the CALLER's, not ours. A fire-and-forget one here
			 * would hold the overlap guard against whoever calls `poll()` next,
			 * making the poller's behaviour depend on how fast the first response
			 * came back.
			 */
			immediate: false
		}
	);
}
