import { describe, expect, it, beforeEach } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';
import { LOCATION_MAP } from '$content/locations';

beforeEach(() => {
	localStorage.clear();
});

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

describe('AeroWindow arrival jitter', () => {
	it('is deterministic per locationId — two panes compute identical cloud/haze settings', () => {
		// 3-Pi panorama regression: setLocation runs independently on each Pi
		// at flight arrival. Math.random() jitter gave every pane its own
		// cloud settings (visible seam) and the peer-synced writes fought via
		// LWW. The jitter is now seeded with daySeed() ^ hashString(locationId)
		// — the same seed setLocationWithSky uses for the orbit.
		const first = new AeroWindow();
		first.applyConfigPatch('atmosphere.haze.amount', 0.07);
		first.setLocation('dubai');
		const a = {
			density: first.config.atmosphere.clouds.density,
			speed: first.config.atmosphere.clouds.speed,
			haze: first.config.atmosphere.haze.amount,
		};

		// Second model = second pane. Haze re-primed because its jitter base
		// is the live config value (shared module singleton across models).
		const second = new AeroWindow();
		second.applyConfigPatch('atmosphere.haze.amount', 0.07);
		second.setLocation('dubai');
		const b = {
			density: second.config.atmosphere.clouds.density,
			speed: second.config.atmosphere.clouds.speed,
			haze: second.config.atmosphere.haze.amount,
		};

		expect(b).toEqual(a);
	});
});
