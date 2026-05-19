import { describe, it, expect } from 'vitest';
import { isValidWeather, isValidDisplayMode, isValidQualityMode } from '$lib/types';
import { isValidLocation, LOCATIONS } from '$content/locations';

describe('isValidWeather', () => {
	it('accepts known weather types', () => {
		expect(isValidWeather('clear')).toBe(true);
		expect(isValidWeather('cloudy')).toBe(true);
		expect(isValidWeather('rain')).toBe(true);
		expect(isValidWeather('overcast')).toBe(true);
		expect(isValidWeather('storm')).toBe(true);
	});
	it('rejects unknown values', () => {
		expect(isValidWeather('snow')).toBe(false);
		expect(isValidWeather('')).toBe(false);
		expect(isValidWeather(42)).toBe(false);
		expect(isValidWeather(null)).toBe(false);
		expect(isValidWeather(undefined)).toBe(false);
		expect(isValidWeather({ weather: 'clear' })).toBe(false);
	});
});

describe('isValidDisplayMode', () => {
	it('accepts known modes', () => {
		expect(isValidDisplayMode('flight')).toBe(true);
		expect(isValidDisplayMode('screensaver')).toBe(true);
		expect(isValidDisplayMode('video')).toBe(true);
	});
	it('rejects unknown', () => {
		expect(isValidDisplayMode('debug')).toBe(false);
		expect(isValidDisplayMode(null)).toBe(false);
	});
});

describe('isValidQualityMode', () => {
	it('accepts known modes', () => {
		expect(isValidQualityMode('performance')).toBe(true);
		expect(isValidQualityMode('balanced')).toBe(true);
		expect(isValidQualityMode('ultra')).toBe(true);
	});
	it('rejects unknown', () => {
		expect(isValidQualityMode('low')).toBe(false);
	});
});

describe('isValidLocation', () => {
	it('accepts every id from the locations catalog', () => {
		for (const loc of LOCATIONS) {
			expect(isValidLocation(loc.id)).toBe(true);
		}
	});
	it('rejects unknown strings', () => {
		expect(isValidLocation('atlantis')).toBe(false);
		expect(isValidLocation('')).toBe(false);
		// URL-param style — lowercasing is the caller's job, the guard doesn't normalize.
		expect(isValidLocation('DUBAI')).toBe(false);
	});
	it('rejects non-strings', () => {
		expect(isValidLocation(42)).toBe(false);
		expect(isValidLocation(null)).toBe(false);
		expect(isValidLocation(undefined)).toBe(false);
		expect(isValidLocation({ id: 'dubai' })).toBe(false);
	});
});

