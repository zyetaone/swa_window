/**
 * DirectorEngine — auto-pilot location selection.
 *
 * "Loiter" for 2-5 minutes over the current city, then suggest a new
 * destination. Returns LocationId | null (intention, not side-effect).
 * The coordinator decides whether to execute the flyTo.
 */

import type { LocationId } from '$lib/shared/types';

export interface DirectorContext {
	userAdjusting: boolean;
	pickNextLocation: () => LocationId;
}

export class DirectorEngine {
	private timer = 0;
	private timeToNext = 120 + Math.random() * 180;

	/** Returns a LocationId to fly to, or null if no action needed. */
	tick(delta: number, ctx: DirectorContext): LocationId | null {
		if (ctx.userAdjusting) {
			this.timer = 0;
			return null;
		}

		this.timer += delta;
		if (this.timer > this.timeToNext) {
			this.timer = 0;
			return ctx.pickNextLocation();
		}

		return null;
	}

	/** Call after a cruise transition completes to reset the loiter timer. */
	reset(): void {
		this.timer = 0;
		this.timeToNext = 120 + Math.random() * 180;
	}
}
