/**
 * FlightSim — the aircraft's current pose as reactive state.
 *
 * The ONLY reactive thing in the flight path: it holds one `$state` struct and
 * replaces it each tick. All the maths lives in `flight.ts`, which is pure.
 */
import { untrack } from 'svelte';

import type { PaneParams } from '#lib/domain/pane.js';
import { windowView, type WindowView } from './flight.js';

export class FlightSim {
	readonly #getParams: () => PaneParams;
	view = $state<WindowView>({} as WindowView);

	constructor(params: PaneParams | (() => PaneParams)) {
		this.#getParams = typeof params === 'function' ? params : () => params;
		this.view = untrack(() => windowView(Date.now() / 1000, this.params));
	}

	get params(): PaneParams {
		return this.#getParams();
	}

	tick(wallSec: number = Date.now() / 1000): WindowView {
		const next = windowView(wallSec, this.params);
		this.view = next;
		return next;
	}

	// No per-field getters. `view` is already one immutable struct, so
	// `flight.view.aglM` reads fine and seven forwarding getters were just seven
	// more things to keep in sync with WindowView. All were unused.
}
