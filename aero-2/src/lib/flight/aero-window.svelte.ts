/**
 * AeroWindow — Svelte 5 root simulation state container & Context DI.
 */
import { getContext, setContext } from 'svelte';
import { FlightSim } from './sim.svelte.js';
import { nightFactor, resolveAtmosphere } from '#lib/domain/atmosphere.js';
import { BLIND_HUD_THRESHOLD, type PaneParams } from '#lib/domain/pane.js';

const AERO_WINDOW_KEY = Symbol('AERO_WINDOW');

export class AeroWindow {
	readonly #getParams: () => PaneParams;
	readonly flight: FlightSim;
	blindClosed = $state(0);

	constructor(params: PaneParams | (() => PaneParams)) {
		this.#getParams = typeof params === 'function' ? params : () => params;
		this.flight = new FlightSim(this.#getParams);
	}

	get params(): PaneParams {
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
		return this.blindClosed < BLIND_HUD_THRESHOLD;
	}

	tick(wallSec?: number) {
		return this.flight.tick(wallSec);
	}
}

export function createAeroWindow(params: PaneParams | (() => PaneParams)): AeroWindow {
	const window = new AeroWindow(params);
	setContext(AERO_WINDOW_KEY, window);
	return window;
}

export function useAeroWindow(): AeroWindow {
	const ctx = getContext<AeroWindow>(AERO_WINDOW_KEY);
	if (!ctx) {
		throw new Error('useAeroWindow() called outside of AeroWindow provider context');
	}
	return ctx;
}
