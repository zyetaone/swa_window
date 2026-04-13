/**
 * EventEngine — micro-events (shooting stars, birds, contrails).
 *
 * Moments of surprise for attentive viewers.
 */

import { MICRO_EVENTS } from '$lib/shared/constants';
import type { ISimulationEngine, SimulationContext } from './ISimulationEngine';

export interface MicroEvent {
	type: 'shooting-star' | 'bird' | 'contrail';
	elapsed: number;
	duration: number;
	x: number;
	y: number;
}

export class EventEngine implements ISimulationEngine<SimulationContext> {
	microEvent = $state<MicroEvent | null>(null);

	private timer = 0;
	private nextEvent: number = MICRO_EVENTS.INITIAL_DELAY;

	tick(delta: number, ctx: SimulationContext): void {
		if (this.microEvent) {
			this.microEvent.elapsed += delta;
			if (this.microEvent.elapsed >= this.microEvent.duration) {
				this.microEvent = null;
			}
			return;
		}

		this.timer += delta;
		if (this.timer < this.nextEvent) return;

		this.timer = 0;
		this.nextEvent = MICRO_EVENTS.MIN_INTERVAL
			+ Math.random() * (MICRO_EVENTS.MAX_INTERVAL - MICRO_EVENTS.MIN_INTERVAL);

		const isNight = ctx.skyState === 'night';
		let type: MicroEvent['type'];
		let duration: number;

		if (isNight) {
			type = 'shooting-star';
			duration = MICRO_EVENTS.SHOOTING_STAR_DURATION;
		} else if (Math.random() < 0.4) {
			type = 'bird';
			duration = MICRO_EVENTS.BIRD_DURATION;
		} else {
			type = 'contrail';
			duration = MICRO_EVENTS.CONTRAIL_DURATION;
		}

		this.microEvent = {
			type,
			elapsed: 0,
			duration,
			x: 10 + Math.random() * 80,
			y: 5 + Math.random() * 40,
		};
	}
}
