import { describe, it, expect, beforeEach } from 'vitest';
import { loadPersistedState, savePersistedState, STORAGE_KEY } from '$lib/persistence';

describe('loadPersistedState', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('returns empty object when no saved state', () => {
		expect(loadPersistedState()).toEqual({});
	});

	it('returns valid saved state', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			location: 'dubai',
			altitude: 30000,
			weather: 'clear',
			cloudDensity: 0.5,
			showBuildings: true,
			showClouds: true,
			syncToRealTime: false,
		}));
		const result = loadPersistedState();
		expect(result.location).toBe('dubai');
		expect(result.altitude).toBe(30000);
		expect(result.weather).toBe('clear');
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

	it('writes to localStorage', () => {
		savePersistedState({
			location: 'dubai',
			altitude: 30000,
			weather: 'clear',
			cloudDensity: 0.5,
			showBuildings: true,
			showClouds: true,
			syncToRealTime: true,
		});
		const raw = localStorage.getItem(STORAGE_KEY);
		expect(raw).toBeTruthy();
		const parsed = JSON.parse(raw!);
		expect(parsed.location).toBe('dubai');
	});
});
