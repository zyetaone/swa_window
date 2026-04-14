import { describe, it, expect } from 'vitest';
import { clamp, lerp, normalizeHeading, randomBetween, pickRandom, shortestAngleDelta, getSkyState, formatTime } from './utils';

describe('clamp', () => {
	it('returns value within range', () => {
		expect(clamp(5, 0, 10)).toBe(5);
	});
	it('clamps to min', () => {
		expect(clamp(-5, 0, 10)).toBe(0);
	});
	it('clamps to max', () => {
		expect(clamp(15, 0, 10)).toBe(10);
	});
});

describe('lerp', () => {
	it('returns a at t=0', () => {
		expect(lerp(0, 100, 0)).toBe(0);
	});
	it('returns b at t=1', () => {
		expect(lerp(0, 100, 1)).toBe(100);
	});
	it('interpolates at midpoint', () => {
		expect(lerp(0, 100, 0.5)).toBe(50);
	});
});

describe('normalizeHeading', () => {
	it('keeps in-range value unchanged', () => {
		expect(normalizeHeading(180)).toBe(180);
	});
	it('wraps 360 to 0', () => {
		expect(normalizeHeading(360)).toBe(0);
	});
	it('wraps 720 to 0', () => {
		expect(normalizeHeading(720)).toBe(0);
	});
	it('wraps -90 to 270', () => {
		expect(normalizeHeading(-90)).toBe(270);
	});
});

describe('randomBetween', () => {
	it('returns within bounds', () => {
		for (let i = 0; i < 100; i++) {
			const v = randomBetween(10, 20);
			expect(v).toBeGreaterThanOrEqual(10);
			expect(v).toBeLessThanOrEqual(20);
		}
	});
});

describe('pickRandom', () => {
	it('returns an element from the array', () => {
		const arr = [1, 2, 3, 4, 5];
		for (let i = 0; i < 100; i++) {
			expect(arr).toContain(pickRandom(arr));
		}
	});
});

describe('shortestAngleDelta', () => {
	it('returns 0 for same angle', () => {
		expect(shortestAngleDelta(90, 90)).toBe(0);
	});
	it('returns positive delta for forward turn', () => {
		expect(shortestAngleDelta(0, 90)).toBe(90);
	});
	it('takes shortest path across 0/360 boundary', () => {
		expect(shortestAngleDelta(350, 10)).toBe(20);
		expect(shortestAngleDelta(10, 350)).toBe(-20);
	});
	it('handles 180° edge', () => {
		expect(Math.abs(shortestAngleDelta(0, 180))).toBe(180);
	});
});

describe('getSkyState', () => {
	it('returns night before 5am', () => {
		expect(getSkyState(4)).toBe('night');
		expect(getSkyState(0)).toBe('night');
	});
	it('returns dawn 5-7am', () => {
		expect(getSkyState(5)).toBe('dawn');
		expect(getSkyState(6.5)).toBe('dawn');
	});
	it('returns day 7am-6pm', () => {
		expect(getSkyState(7)).toBe('day');
		expect(getSkyState(12)).toBe('day');
		expect(getSkyState(17.9)).toBe('day');
	});
	it('returns dusk 6-8pm', () => {
		expect(getSkyState(18)).toBe('dusk');
		expect(getSkyState(19.9)).toBe('dusk');
	});
	it('returns night after 8pm', () => {
		expect(getSkyState(20)).toBe('night');
		expect(getSkyState(23.5)).toBe('night');
	});
});

describe('formatTime', () => {
	it('formats noon as 12:00 PM', () => {
		expect(formatTime(12)).toBe('12:00 PM');
	});
	it('formats midnight as 12:00 AM', () => {
		expect(formatTime(0)).toBe('12:00 AM');
	});
	it('formats half-hours', () => {
		expect(formatTime(14.5)).toBe('2:30 PM');
	});
	it('wraps 24 to midnight', () => {
		expect(formatTime(24)).toBe('12:00 AM');
	});
	it('handles negative times', () => {
		expect(formatTime(-1)).toBe('11:00 PM');
	});
});
