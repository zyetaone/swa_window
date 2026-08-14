import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';
import { LOCATION_MAP } from '$content/locations';
import { STORAGE_KEY } from '$lib/model/persistence';
import { daySeed } from '$lib/world/prng';

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	vi.useRealTimers();
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

	it('does not clobber timeOfDay with wall-clock when syncToRealTime is false', () => {
		// Regression: boot called updateTimeFromSystem() unconditionally while
		// the recurring sync in +page.svelte is gated on syncToRealTime — a
		// persisted syncToRealTime:false kiosk booted to wall-clock and then
		// froze there. 23:30 wall-clock vs the show's dawn opening keeps the
		// assertion well clear of coincidence.
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T23:30:00'));
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ syncToRealTime: false }));
		const model = new AeroWindow();
		expect(Math.abs(model.timeOfDay - 23.5)).toBeGreaterThan(2);
	});

	it('restores persisted ambient peer-sync values over show-opening defaults', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			dayKey: daySeed(),
			ambient: {
				'world.nightLightIntensity': 3.5,
				'shell.clockVisible': true,
				'world.qualityMode': 'ultra',
				'world.useHashPalette': false,
			},
		}));
		const model = new AeroWindow();
		expect(model.config.world.nightLightIntensity).toBe(3.5);
		expect(model.config.shell.clockVisible).toBe(true);
		expect(model.config.world.qualityMode).toBe('ultra');
		expect(model.config.world.useHashPalette).toBe(false);
		// Restore defaults so later tests in this file see stock config.
		model.applyConfigPatch('world.nightLightIntensity', 5.0);
		model.applyConfigPatch('shell.clockVisible', false);
		model.applyConfigPatch('world.qualityMode', 'performance');
		model.applyConfigPatch('world.useHashPalette', true);
	});

	it('getPersistedSnapshot captures ambient peer-sync values (and skips legacy-named paths)', () => {
		const model = new AeroWindow();
		model.applyConfigPatch('world.viirsBrightness', 1.7);
		try {
			const snap = model.getPersistedSnapshot();
			expect(snap.ambient['world.viirsBrightness']).toBe(1.7);
			expect(snap.ambient['world.qualityMode']).toBe(model.config.world.qualityMode);
			// These three are covered by the named snapshot fields — ambient
			// must not duplicate them (two sources for one leaf).
			expect(snap.ambient['world.showClouds']).toBeUndefined();
			expect(snap.ambient['world.buildingsEnabled']).toBeUndefined();
			expect(snap.ambient['atmosphere.clouds.density']).toBeUndefined();
		} finally {
			model.applyConfigPatch('world.viirsBrightness', 3.0);
		}
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
