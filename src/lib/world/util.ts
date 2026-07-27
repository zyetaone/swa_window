/**
 * EpsilonGate<T> — write a Cesium property only when its value has changed
 * beyond a perceptible epsilon.
 *
 * Cesium setter calls trigger GPU uniform / scene-graph updates. Calling
 * `layer.alpha = 0.5` every frame at 60 Hz, even when the value is
 * identical, costs a GPU sync per call. The managers wrap each controlled
 * property in this 3-state gate:
 *
 *   1. first call after construction  → write (last seeded with sentinel)
 *   2. |Δ| > epsilon                  → write
 *   3. otherwise                      → no-op (still tracks last, so the
 *                                       next divergence triggers the write)
 *
 * Epsilons are chosen per-property by the site that needs them; numbers
 * below perception (< 0.005 alpha, < 0.01 brightness) so admin sliders
 * still feel live to the operator. Defaults to a strict 0 (≡ reference
 * equality for scalars) when no epsilon is given.
 */
export class EpsilonGate<T> {
	private last: T;
	constructor(private readonly epsilon: number, init: T) {
		this.last = init;
	}

	/**
	 * Apply `value` via `setter` only if it differs from the last-applied
	 * value by more than `epsilon` (scalar) or by reference (object/array).
	 */
	update(value: T, setter: (v: T) => void): void {
		if (this.#shouldWrite(value)) {
			setter(value);
			this.last = value;
		}
	}

	/** Force-write on next update() — useful after a manual external change. */
	reset(): void {
		this.last = this.#sentinel();
	}

	#shouldWrite(value: T): boolean {
		const a = this.last as unknown;
		const b = value as unknown;
		if (typeof a === 'number' && typeof b === 'number') {
			return Math.abs(a - b) > this.epsilon;
		}
		return a !== b;
	}

	#sentinel(): T {
		const t = this.last as unknown;
		return (typeof t === 'number' ? Number.NaN : Symbol() as unknown) as T;
	}
}
