/**
 * DirectorEngine — auto-pilot location selection.
 *
 * Suggests a new destination after loitering.
 */

import type { LocationId } from '$lib/shared/types';
import type { ISimulationEngine, SimulationContext } from './ISimulationEngine';

export interface DirectorContext extends SimulationContext {
	pickNextLocation: () => LocationId;
}

export class DirectorEngine implements ISimulationEngine<DirectorContext, LocationId | null> {
	private timer = 0;
	private timeToNext = 120 + Math.random() * 180;

	/** Returns a LocationId to fly to, or null if no action needed. */
	tick(delta: number, ctx: DirectorContext): LocationId | null {
		if (ctx.userAdjustingAltitude || ctx.userAdjustingTime) {
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
