import { describe, expect, it } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';
import { LOCATION_MAP } from '$content/locations';

describe('AeroWindow boot', () => {
	it('moves the flight to the boot location (show opening, no persisted state)', () => {
		const model = new AeroWindow();
		const loc = LOCATION_MAP.get(model.location);
		expect(loc).toBeDefined();
		// Regression guard (Jul 8): applyShowOpening set only the location FIELD,
		// leaving the flight orbiting FlightSimEngine's class-field default
		// (Dubai 25.2/55.27) whenever nothing was persisted.
		expect(model.flight.orbitCenterLat).toBeCloseTo(loc!.lat, 5);
		expect(model.flight.orbitCenterLon).toBeCloseTo(loc!.lon, 5);
	});
});
