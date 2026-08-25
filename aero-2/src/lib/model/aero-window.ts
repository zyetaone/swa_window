import { getContext, setContext } from 'svelte';
import { ConfigTree } from '#lib/model/config.svelte.js';
import { FlightEngine } from '#lib/model/flight.svelte.js';
import { Location } from '#lib/location.js';
import type { GlobeSyncSlice } from '#lib/types.js';

const AERO_WINDOW_KEY = Symbol('aero-window');

/** Root sim object — config, location, flight engine. */
export class AeroWindow {
	readonly config = new ConfigTree();
	readonly location: Location;
	readonly flight: FlightEngine;

	constructor(location: Location = Location.hyderabad()) {
		this.location = location;
		this.flight = new FlightEngine(this.config, location);
	}

	tick(dt: number): void {
		this.flight.tick(dt);
	}

	frame(): GlobeSyncSlice {
		return this.flight.frame();
	}
}

export function createAeroWindow(location?: Location): AeroWindow {
	const model = new AeroWindow(location);
	setContext(AERO_WINDOW_KEY, model);
	return model;
}

export function useAeroWindow(): AeroWindow {
	return getContext<AeroWindow>(AERO_WINDOW_KEY);
}
