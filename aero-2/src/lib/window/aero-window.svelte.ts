/**
 * Root of the simulation: config + location + the flight engine that moves it.
 */
import { Location } from '#lib/world/locations.js';
import { ConfigTree } from '#lib/window/config.js';
import { FlightEngine } from '#lib/flight/engine.svelte.js';
import type { FlightFrame } from '#lib/flight/model.js';

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

	frame(): FlightFrame {
		return this.flight.frame();
	}
}

export function createAeroWindow(location?: Location): AeroWindow {
	return new AeroWindow(location);
}

/** `?place=denver` — so a place can be looked at without a rebuild. */
export function aeroWindowFromUrl(search: string): AeroWindow {
	return new AeroWindow(Location.byId(new URLSearchParams(search).get('place')));
}
