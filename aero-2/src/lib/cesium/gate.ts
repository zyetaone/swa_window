/**
 * Change damping for the render layer.
 */

/**
 * Damps a noisy scalar: `changed()` is true only once the value has moved far
 * enough to be worth acting on, and remembers the value it last accepted.
 *
 * Every caller guards something expensive AND visible — retiling the globe,
 * swapping an imagery provider, toggling globe lighting. Undamped, each would
 * fire repeatedly while its input hovers near a boundary, and on three panes it
 * would fire on different frames, which reads as a torn wall rather than a slow
 * one.
 */
export class EpsilonGate {
	#last: number;

	constructor(private readonly eps: number = 0.001, initial: number = -Infinity) {
		this.#last = initial;
	}

	changed(val: number): boolean {
		if (Math.abs(val - this.#last) > this.eps) {
			this.#last = val;
			return true;
		}
		return false;
	}

	reset(): void {
		this.#last = -Infinity;
	}
}
