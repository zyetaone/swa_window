/**
 * AeroWindow — Svelte 5 root simulation state container.
 */
import { FlightSim } from '#lib/flight/FlightSim.svelte.js';
import { resolveAtmosphere } from '#lib/stage/atmosphere.js';
import { nightFactor } from '#lib/stage/lighting.js';
import type { WindowParams } from './params.js';

export class AeroWindow {
	readonly #getParams: () => WindowParams;
	readonly flight: FlightSim;
	blindClosed = $state(0);

	constructor(params: WindowParams | (() => WindowParams)) {
		this.#getParams = typeof params === 'function' ? params : () => params;
		this.flight = new FlightSim(this.#getParams);
	}

	get params(): WindowParams {
		return this.#getParams();
	}

	get view() {
		return this.flight.view;
	}

	get atmosphere() {
		return resolveAtmosphere(this.flight.view.aglM);
	}

	get night() {
		return nightFactor(this.flight.view.timeOfDay);
	}

	get hudVisible() {
		return this.blindClosed < 0.5;
	}

	tick(wallSec?: number) {
		return this.flight.tick(wallSec);
	}
}
