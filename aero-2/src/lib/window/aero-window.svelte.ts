/**
 * Root of the simulation: config + location + the flight engine that moves it.
 */
import { Location } from '#lib/world/locations.js';
import { ConfigTree } from '#lib/window/config.js';
import { FlightEngine } from '#lib/flight/engine.svelte.js';
import type { FlightFrame } from '#lib/flight/model.js';

export class AeroWindow {
	readonly config: ConfigTree;
	readonly location: Location;
	readonly flight: FlightEngine;

	constructor(location: Location = Location.hyderabad(), windowAzimuthDeg?: number) {
		this.config = new ConfigTree(windowAzimuthDeg);
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

/** `?place=denver&azimuth=-75` — a place and a pane, without a rebuild. */
export function aeroWindowFromUrl(search: string): AeroWindow {
	const q = new URLSearchParams(search);
	const azimuth = Number(q.get('azimuth'));
	return new AeroWindow(
		Location.byId(q.get('place')),
		Number.isFinite(azimuth) && q.has('azimuth') ? azimuth : undefined,
	);
}
