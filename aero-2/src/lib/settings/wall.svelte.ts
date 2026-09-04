/**
 * The receiving half of the wall state: a buffer, and one function that empties
 * it at a named second.
 *
 * THE BUG THIS EXISTS TO AVOID. The obvious implementation applies a snapshot
 * when its fetch resolves. That makes network jitter an input to the pose:
 * three panes with three different fetch latencies render three different
 * configs at the same `wallSec`. It is `+= dt` arriving over the network, and
 * the source scan cannot see it because there is no accumulator to spot.
 *
 * So the fetch only fills a buffer. Nothing but `advanceTo` ever acts on it,
 * through `applyDue(wallSec, config)`, which makes the assignment itself a pure
 * function of the wall clock:
 *
 *     world = f(wallSec, effectiveWall(wallSec, snapshots), paneKnobs, daySeed)
 *
 * Two panes that received the same snapshot 1.5 s apart compute identical
 * config at every `wallSec`.
 */

import { Location } from './locations.js';
import type { PaneSettings } from './settings.svelte.js';
import type { WallSnapshot, WallState } from '#lib/wall.js';

export class WallSync {
	/** Highest version applied. Also what the poller conditions its GET on. */
	appliedVersion = $state(0);
	/** Buffered and not yet due. Read by the drawer's "applies in Ns" countdown. */
	pending = $state.raw<WallSnapshot | null>(null);

	/**
	 * Buffer a snapshot. Deliberately does nothing else — receiving is not
	 * applying, and that separation is the whole design.
	 */
	receive(snapshot: WallSnapshot | null | undefined): void {
		if (!snapshot || snapshot.version <= this.appliedVersion) return;
		// A newer push supersedes an older one still waiting: the operator changed
		// their mind inside the lead time, and only the last one should land.
		this.pending = snapshot;
	}

	/**
	 * Apply the buffered snapshot if its second has arrived. Called from
	 * `advanceTo` BEFORE `director.tick`, so a snapshot that pins a place and
	 * clears `rotate` is seen by the same tick that would otherwise have rotated
	 * past it — the existing flag arbitrates, no new logic.
	 */
	applyDue(wallSec: number, config: PaneSettings): void {
		const due = this.pending;
		if (!due || wallSec < due.applyAtWallSec) return;

		this.pending = null;
		this.appliedVersion = due.version;
		applyWallState(due.state, config, wallSec);
	}
}

/**
 * Assign the seven wall keys, and nothing else.
 *
 * `wallSec` is threaded into `applyPreset` rather than letting it default.
 * Its docstring accepted a defaulted clock because a preset was an operator
 * action on one pane — true then. Arriving through a shared `applyAtWallSec` it
 * IS a derived quantity, so the second it is derived from has to be the one
 * every pane agrees on.
 */
export function applyWallState(state: WallState, config: PaneSettings, wallSec: number): void {
	// Preset first: it rewrites place and clockOffsetH, so anything explicit in
	// the snapshot must land after it and win.
	if (state.presetId) config.applyPreset(state.presetId, wallSec);
	if (state.placeId) config.setPlace(Location.byId(state.placeId));

	config.weather = state.weather as PaneSettings['weather'];
	config.clockOffsetH = state.clockOffsetH;
	config.displayMode = state.displayMode as PaneSettings['displayMode'];
	config.blindOpen = state.blindOpen;
	config.rotate = state.rotate;
}
