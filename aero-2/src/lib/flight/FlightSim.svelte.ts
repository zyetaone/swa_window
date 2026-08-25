/**
 * FlightSim — reactive simulation state for aircraft pose and camera target.
 */
import { untrack } from 'svelte';
import { windowView, type WindowView } from './view.js';
import type { WindowParams } from '#lib/sim/params.js';

export class FlightSim {
	readonly #getParams: () => WindowParams;
	view = $state<WindowView>({} as WindowView);

	constructor(params: WindowParams | (() => WindowParams)) {
		this.#getParams = typeof params === 'function' ? params : () => params;
		this.view = untrack(() => windowView(Date.now() / 1000, this.params));
	}

	get params(): WindowParams {
		return this.#getParams();
	}

	tick(wallSec: number = Date.now() / 1000): WindowView {
		const next = windowView(wallSec, this.params);
		this.view = next;
		return next;
	}

	get lat() {
		return this.view.lat;
	}

	get lon() {
		return this.view.lon;
	}

	get aglM() {
		return this.view.aglM;
	}

	get mslM() {
		return this.view.mslM;
	}

	get headingDeg() {
		return this.view.headingDeg;
	}

	get trackDeg() {
		return this.view.trackDeg;
	}

	get timeOfDay() {
		return this.view.timeOfDay;
	}
}
