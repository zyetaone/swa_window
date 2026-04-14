import { describe, it, expect } from 'vitest';
import { isValidWeather, isValidDisplayMode, isValidQualityMode, safeParse } from './validation';

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

describe('safeParse', () => {
	it('parses valid JSON', () => {
		expect(safeParse('{"a":1}')).toEqual({ a: 1 });
		expect(safeParse('[1,2,3]')).toEqual([1, 2, 3]);
	});
	it('returns null on malformed JSON', () => {
		expect(safeParse('not json')).toBe(null);
		expect(safeParse('{')).toBe(null);
		expect(safeParse('')).toBe(null);
	});
});
