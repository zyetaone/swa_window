import { describe, it, expect } from 'vitest';
import { formatClock, formatUtcOffset } from '#lib/format.js';

describe('formatClock', () => {
	/**
	 * The two private copies this replaced DISAGREED: Settings rounded minutes,
	 * the Hud floored them, so one timeOfDay could read 17:41 in the drawer and
	 * 17:40 on the ribbon at the same instant. Flooring won — a clock shows
	 * 17:40 until 17:41 IS true.
	 */
	it('floors, never rounds', () => {
		expect(formatClock(17.6934)).toBe('17:41');
		expect(formatClock(17.69)).toBe('17:41');
		expect(formatClock(17.6749)).toBe('17:40');
	});

	it('wraps 24h and pads', () => {
		expect(formatClock(0)).toBe('00:00');
		expect(formatClock(24)).toBe('00:00');
		expect(formatClock(9.5)).toBe('09:30');
	});

	it('refuses NaN with a readable placeholder', () => {
		expect(formatClock(NaN)).toBe('--:--');
	});
});

describe('formatUtcOffset', () => {
	it('whole and fractional zones', () => {
		expect(formatUtcOffset(-6)).toBe('UTC-6');
		expect(formatUtcOffset(5.5)).toBe('UTC+5:30');
		expect(formatUtcOffset(5.75)).toBe('UTC+5:45');
		expect(formatUtcOffset(0)).toBe('UTC+0');
	});
});
