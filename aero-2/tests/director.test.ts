import { describe, it, expect } from 'vitest';
import { FlightDirector } from '../src/lib/display/flight/director.svelte.js';
import { createSettings } from '../src/lib/settings/settings.svelte.js';
import { LOCATIONS } from '../src/lib/settings/locations.js';

describe('FlightDirector', () => {
	it('initializes with default enabled state and destination index 0', () => {
		const settings = createSettings();
		const director = new FlightDirector(settings);
		expect(director.enabled).toBe(true);
		expect(director.currentDestinationIndex).toBe(0);
	});

	it('advances destination through catalog locations', () => {
		const settings = createSettings();
		const director = new FlightDirector(settings);

		director.advanceDestination();
		expect(director.currentDestinationIndex).toBe(1);
		expect(settings.place.id).toBe(LOCATIONS[1].id);

		director.advanceDestination();
		expect(director.currentDestinationIndex).toBe(2);
		expect(settings.place.id).toBe(LOCATIONS[2].id);
	});

	it('triggers callback on destination change', () => {
		const settings = createSettings();
		const director = new FlightDirector(settings);
		let calledWith: string | null = null;

		director.advanceDestination((loc) => {
			calledWith = loc.id;
		});

		expect(calledWith).toBe(LOCATIONS[1].id);
	});
});
