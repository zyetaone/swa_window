import { describe, it, expect, vi } from 'vitest';
import { windowView } from '#lib/flight/view.js';
import { readWindowParams } from '#lib/window/params.js';
import { resolveLocalHours } from '#lib/flight/clock.js';
import { Location } from '#lib/world/locations.js';

/**
 * These call `windowView` — the SAME function routes/+page.svelte calls once a
 * frame — rather than re-deriving the composition here. The previous version of
 * this file duplicated the frame maths and claimed to "mirror" the page, which
 * meant it could stay green while the page drifted away from it.
 */
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
		// Three panes, one aircraft: SAME INSTANT, three azimuths. The time has to
		// be pinned — pose is a pure function of wall-clock time, so ticking three
		// windows across a millisecond boundary legitimately yields three
		// positions. That is the invariant working, not breaking.
		const wallT = new Date('2026-08-25T09:30:00Z').getTime() / 1000;
		const panes = [-105, -90, -75].map((az) => windowView(wallT, paramsFor(`?azimuth=${az}`)));
		expect(panes[1].lat).toBe(panes[0].lat);
		expect(panes[2].aglM).toBe(panes[0].aglM);
		expect(panes[1].headingDeg).not.toBe(panes[0].headingDeg);
	});

	it('same wall-clock instant, independent calls, identical pose', () => {
		// The fleet invariant itself: three Pis are three processes that share
		// nothing but the clock. Call order must not leak into the pose.
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
