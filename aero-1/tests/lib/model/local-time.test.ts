import { describe, it, expect } from 'vitest';
import {
	isValidTimeZone,
	localHoursInTimeZone,
	localHoursFromUtcOffset,
	resolveLocalHours,
} from '$lib/model/local-time';

describe('localHoursFromUtcOffset', () => {
	it('adds fixed offset to UTC', () => {
		const now = new Date('2026-01-15T10:30:00Z'); // standard time
		expect(localHoursFromUtcOffset(4, now)).toBeCloseTo(14.5, 5);
		expect(localHoursFromUtcOffset(-10, now)).toBeCloseTo(0.5, 5);
	});
});

describe('localHoursInTimeZone', () => {
	it('returns null for invalid zone', () => {
		expect(localHoursInTimeZone('Not/A_Real_Zone')).toBeNull();
	});

	it('resolves Asia/Dubai (no DST) like fixed +4', () => {
		const now = new Date('2026-07-15T10:30:00Z');
		const h = localHoursInTimeZone('Asia/Dubai', now);
		expect(h).toBeCloseTo(14.5, 5);
	});

	it('applies DST for America/Chicago (CDT in July = UTC−5)', () => {
		// 10:30 UTC → 05:30 CDT
		const summer = new Date('2026-07-15T10:30:00Z');
		expect(localHoursInTimeZone('America/Chicago', summer)).toBeCloseTo(5.5, 5);
		// January CST = UTC−6 → 04:30
		const winter = new Date('2026-01-15T10:30:00Z');
		expect(localHoursInTimeZone('America/Chicago', winter)).toBeCloseTo(4.5, 5);
	});
});

describe('resolveLocalHours', () => {
	it('prefers zone override over location zone', () => {
		const now = new Date('2026-07-15T10:30:00Z');
		// Location Dallas zone would be CDT 05:30; override UTC → 10:30
		const h = resolveLocalHours({
			timeZone: 'America/Chicago',
			utcOffset: -6,
			zoneOverride: 'UTC',
			now,
		});
		expect(h).toBeCloseTo(10.5, 5);
	});

	it('falls back to utcOffset when zone is invalid', () => {
		const now = new Date('2026-01-15T10:30:00Z');
		const h = resolveLocalHours({
			timeZone: 'Invalid/Zone',
			utcOffset: 4,
			now,
		});
		expect(h).toBeCloseTo(14.5, 5);
	});
});

describe('isValidTimeZone', () => {
	it('accepts real IANA zone ids', () => {
		expect(isValidTimeZone('America/Chicago')).toBe(true);
		expect(isValidTimeZone('UTC')).toBe(true);
		expect(isValidTimeZone('Asia/Kathmandu')).toBe(true);
	});

	it('rejects garbage — the wire/localStorage trust boundary', () => {
		expect(isValidTimeZone('Not/AZone')).toBe(false);
		expect(isValidTimeZone('')).toBe(false);
		expect(isValidTimeZone(undefined)).toBe(false);
		expect(isValidTimeZone(42)).toBe(false);
	});
});
