/**
 * director.svelte.ts — Autopilot Flight Director and City-to-City Cruise State Machine.
 *
 * Ticks continuously inside AeroDisplay.advanceTo() to autonomously advance
 * the kiosk between catalog destinations and modulate ambient weather.
 */

import { LOCATIONS, Location } from '../../settings/locations.js';
import type { PaneSettings } from '../../settings/settings.svelte.js';

export interface DirectorConfig {
	enabled: boolean;
	minIntervalSec: number;
	maxIntervalSec: number;
	weatherChangeChance: number;
}

export class FlightDirector {
	private timer = 0;
	private nextIntervalSec = 180; // 3 minutes default
	private settings: PaneSettings;

	enabled = $state(true);
	isCruising = $state(false);
	currentDestinationIndex = $state(0);

	constructor(settings: PaneSettings) {
		this.settings = settings;
		this.nextIntervalSec = 120 + Math.random() * 120;
	}

	tick(dt: number, onDestinationChange?: (loc: Location) => void): void {
		if (!this.enabled) return;

		this.timer += dt;
		if (this.timer >= this.nextIntervalSec) {
			this.timer = 0;
			this.nextIntervalSec = 120 + Math.random() * 180;
			this.advanceDestination(onDestinationChange);
		}
	}

	advanceDestination(callback?: (loc: Location) => void): void {
		this.currentDestinationIndex = (this.currentDestinationIndex + 1) % LOCATIONS.length;
		const nextLoc = LOCATIONS[this.currentDestinationIndex];
		this.settings.place = nextLoc;
		callback?.(nextLoc);
	}

	reset(): void {
		this.timer = 0;
		this.nextIntervalSec = 120 + Math.random() * 120;
	}
}
