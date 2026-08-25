/**
 * Root of the simulation: config + location + the flight engine that moves it.
 */
import { Location } from '#lib/content/locations.js';
import { ConfigTree } from '#lib/sim/config.js';
import { FlightEngine } from '#lib/sim/flight.svelte.js';
import type { GlobeSyncSlice } from '#lib/sim/frame.js';

export class AeroWindow {
	readonly config = new ConfigTree();
	readonly location: Location;
	readonly flight: FlightEngine;

	constructor(location: Location = Location.hyderabad()) {
		this.location = location;
		this.flight = new FlightEngine(this.config, location);
	}

	tick(): void {
		this.flight.tick();
	}

	frame(): GlobeSyncSlice {
		return this.flight.frame();
	}
}

export function createAeroWindow(location?: Location): AeroWindow {
	return new AeroWindow(location);
}
