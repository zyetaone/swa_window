import { describe, it, expect, beforeEach } from 'vitest';
import { loadPersistedState, savePersistedState, STORAGE_KEY } from '$lib/model/aero-window-persistence';
import { daySeed } from '$lib/world-three/prng';

describe('loadPersistedState', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('returns empty object when no saved state', () => {
		expect(loadPersistedState()).toEqual({});
	});

	it('returns valid saved state when dayKey matches today', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			location: 'dubai',
			altitude: 30000,
			weather: 'clear',
			cloudDensity: 0.5,
			showBuildings: true,
			showClouds: true,
			syncToRealTime: false,
			dayKey: daySeed(),
		}));
		const result = loadPersistedState();
		expect(result.location).toBe('dubai');
		expect(result.altitude).toBe(30000);
		expect(result.weather).toBe('clear');
	});

	it('strips location + weather when dayKey is missing (legacy state from before rotation gate)', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			location: 'dubai',
			altitude: 30000,
			weather: 'clear',
			cloudDensity: 0.5,
		}));
		const result = loadPersistedState();
		expect(result.location).toBeUndefined();
		expect(result.weather).toBeUndefined();
		// Non-scene fields (operator preferences) persist across days.
		expect(result.altitude).toBe(30000);
		expect(result.cloudDensity).toBe(0.5);
	});

	it('strips location + weather when stored dayKey doesnt match today', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			location: 'dubai',
			altitude: 30000,
			weather: 'clear',
			dayKey: daySeed() - 1, // yesterday
		}));
		const result = loadPersistedState();
		expect(result.location).toBeUndefined();
		expect(result.weather).toBeUndefined();
		expect(result.altitude).toBe(30000);
	});

	it('never leaks the dayKey field to consumers', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			location: 'dubai',
			weather: 'clear',
			dayKey: daySeed(),
		}));
		const result = loadPersistedState() as Record<string, unknown>;
		expect(result.dayKey).toBeUndefined();
		expect(result.location).toBe('dubai');
	});

	it('rejects invalid location', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ location: 'atlantis' }));
		expect(loadPersistedState().location).toBeUndefined();
	});

	it('rejects invalid weather', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ weather: 'snow' }));
		expect(loadPersistedState().weather).toBeUndefined();
	});

	it('clamps out-of-range altitude', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ altitude: 999999 }));
		const r = loadPersistedState();
		expect(r.altitude).toBeLessThanOrEqual(65000);
	});

	it('returns empty on malformed JSON', () => {
		localStorage.setItem(STORAGE_KEY, 'not json');
		expect(loadPersistedState()).toEqual({});
	});

	it('returns empty for non-object payload', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'b']));
		expect(loadPersistedState()).toEqual({});
	});

	it('strips invalid boolean fields', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ showClouds: 'yes' }));
		expect(loadPersistedState().showClouds).toBeUndefined();
	});
});

describe('savePersistedState', () => {
	beforeEach(() => localStorage.clear());

	it('writes to localStorage and stamps todays dayKey', () => {
		savePersistedState({
			location: 'dubai',
			altitude: 30000,
			weather: 'clear',
			cloudDensity: 0.5,
			buildingsEnabled: true,
			showClouds: true,
			syncToRealTime: true,
		});
		const raw = localStorage.getItem(STORAGE_KEY);
		expect(raw).toBeTruthy();
		const parsed = JSON.parse(raw!);
		expect(parsed.location).toBe('dubai');
		// dayKey is stamped automatically so a subsequent load on the same
		// day preserves location/weather — daily rotation gate inverse.
		expect(parsed.dayKey).toBe(daySeed());
	});
});
