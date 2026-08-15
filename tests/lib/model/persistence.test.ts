import { describe, it, expect, beforeEach } from 'vitest';
import { loadPersistedState, savePersistedState, STORAGE_KEY } from '$lib/model/persistence';

describe('loadPersistedState', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('returns empty object when no saved state', () => {
		expect(loadPersistedState()).toEqual({});
	});

	it('never restores location, weather, or syncToRealTime (boot owns modes)', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			location: 'dubai',
			altitude: 30000,
			weather: 'clear',
			cloudDensity: 0.5,
			showClouds: true,
			syncToRealTime: false,
			dayKey: 999999,
		}));
		const result = loadPersistedState();
		expect(result.location).toBeUndefined();
		expect(result.weather).toBeUndefined();
		expect(result.syncToRealTime).toBeUndefined();
		expect(result.altitude).toBe(30000);
		expect(result.cloudDensity).toBe(0.5);
	});

	it('strips dayKey from consumers', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			altitude: 30000,
			dayKey: 12345,
		}));
		const result = loadPersistedState() as Record<string, unknown>;
		expect(result.dayKey).toBeUndefined();
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

	it('loads ambient operator prefs', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			altitude: 30000,
			ambient: { 'world.qualityMode': 'balanced' },
		}));
		const r = loadPersistedState();
		expect(r.ambient?.['world.qualityMode']).toBe('balanced');
	});
});

describe('savePersistedState', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('does not write location, weather, or syncToRealTime', () => {
		savePersistedState({
			location: 'dubai',
			weather: 'rain',
			altitude: 32000,
			cloudDensity: 0.5,
			buildingsEnabled: true,
			showClouds: true,
			syncToRealTime: true,
			ambient: {},
		});
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
		expect(parsed.location).toBeUndefined();
		expect(parsed.weather).toBeUndefined();
		expect(parsed.syncToRealTime).toBeUndefined();
		expect(parsed.altitude).toBe(32000);
	});

	it('does not restore shell.windowFrame from ambient (mode, not site tuning)', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			altitude: 30000,
			ambient: {
				'shell.windowFrame': true,
				'world.qualityMode': 'balanced',
			},
		}));
		const r = loadPersistedState();
		expect(r.ambient?.['shell.windowFrame']).toBeUndefined();
		expect(r.ambient?.['world.qualityMode']).toBe('balanced');
	});
});
