import { describe, it, expect, vi } from 'vitest';
import { resolveLocalHours, windowView } from '#lib/sim/flight.svelte.js';
import { readWindowParams } from '#lib/sim/params.js';
import { Location } from '#lib/config/locations.js';

const paramsFor = (search = '') => readWindowParams(new URL(`http://kiosk.local/${search}`));

describe('windowView', () => {
	it('produces finite, in-range numbers', () => {
		const v = windowView(1_787_650_000, paramsFor());
		expect(Number.isFinite(v.lat)).toBe(true);
		expect(Number.isFinite(v.lon)).toBe(true);
		expect(Number.isFinite(v.aglM)).toBe(true);
		expect(Number.isFinite(v.targetLat)).toBe(true);
		expect(Number.isFinite(v.targetLon)).toBe(true);
		expect(v.headingDeg).toBeGreaterThanOrEqual(0);
		expect(v.headingDeg).toBeLessThan(360);
	});

	it('places the camera above local ground, not above the sea', () => {
		const v = windowView(1_787_650_000, paramsFor());
		expect(v.mslM).toBeCloseTo(Location.hyderabad().groundElevationM + v.aglM, 6);
	});
});

describe('resolveLocalHours', () => {
	it('resolves a known IANA zone', () => {
		const h = resolveLocalHours({ timeZone: 'UTC', now: new Date('2026-01-15T12:00:00Z') });
		expect(h).toBeCloseTo(12, 1);
	});
});

describe('window azimuth', () => {
	it('looks out of the side, not down the track — this is a window, not a windscreen', () => {
		const v = windowView(1_787_650_000, paramsFor('?azimuth=-90'));
		const delta = ((((v.headingDeg - v.trackDeg) % 360) + 540) % 360) - 180;
		expect(delta).toBeCloseTo(-90, 6);
	});

	it('wraps rather than emitting a negative heading', () => {
		const v = windowView(1_787_650_000, paramsFor('?azimuth=-270'));
		expect(v.headingDeg).toBeGreaterThanOrEqual(0);
		expect(v.headingDeg).toBeLessThan(360);
	});

	it('a pane offset is the only per-screen difference', () => {
		const wallT = new Date('2026-08-25T09:30:00Z').getTime() / 1000;
		const panes = [-105, -90, -75].map((az) => windowView(wallT, paramsFor(`?azimuth=${az}`)));
		expect(panes[1].lat).toBe(panes[0].lat);
		expect(panes[2].aglM).toBe(panes[0].aglM);
		expect(panes[1].headingDeg).not.toBe(panes[0].headingDeg);
	});

	it('same wall-clock instant, independent calls, identical pose', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-25T17:45:12.345Z'));
		try {
			const wallT = Date.now() / 1000;
			const now = new Date();
			expect(windowView(wallT, paramsFor(), now)).toEqual(windowView(wallT, paramsFor(), now));
		} finally {
			vi.useRealTimers();
		}
	});
});
