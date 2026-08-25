import { describe, it, expect, vi } from 'vitest';
import { altitudeAt, orbitPose, resolveLocalHours, windowView } from '#lib/sim/flight.js';
import { readPaneParams } from '#lib/sim/url-params.js';
import { Location } from '#lib/domain/locations.js';
// This file's altitude tests assert the climb VISITS every atmosphere band —
// a cross-module claim, so it legitimately needs the band table.
import { ATMOSPHERE_BANDS, resolveAtmosphere } from '#lib/domain/atmosphere.js';
import { ALTITUDE_CEILING_M, ALTITUDE_FLOOR_M, CLIMB_PERIOD_SEC, ORBIT } from '#lib/domain/pane.js';

const paramsFor = (search = '') => readPaneParams(new URL(`http://kiosk.local/${search}`));

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

describe('orbitPose', () => {
	const base = {
		centerLat: 17.385,
		centerLon: 78.4867,
		orbitAngle0: 0.5,
		orbitBearingRad: 0,
		direction: 1,
		majorMin: 0.08,
		majorMax: 0.25,
		breathePeriod: 180,
		driftRate: 0.018,
		flightSpeed: 6
	};

	it('is deterministic — wall-clock time is the only input', () => {
		const now = 1_787_650_000;
		const a = orbitPose({ ...base, wallT: now });
		const b = orbitPose({ ...base, wallT: now });
		expect(b).toEqual(a);
	});

	it('stays finite and keeps moving an hour in', () => {
		const t0 = 1_787_650_000;
		const a = orbitPose({ ...base, wallT: t0 });
		const b = orbitPose({ ...base, wallT: t0 + 3_600 });
		for (const p of [a, b]) {
			expect(Number.isFinite(p.lat)).toBe(true);
			expect(Number.isFinite(p.lon)).toBe(true);
			expect(p.orbitAngle).toBeGreaterThanOrEqual(0);
			expect(p.orbitAngle).toBeLessThan(Math.PI * 2);
		}
		expect(b.lat).not.toBe(a.lat);
	});
});

describe('altitudeAt', () => {
	it('is absolute in wall time — three panes fly at one height', () => {
		const now = 1_787_650_000;
		expect(altitudeAt(now)).toBe(altitudeAt(now));
		expect(Math.abs(altitudeAt(now + 1 / 60) - altitudeAt(now))).toBeLessThan(1);
	});

	it('visits every band across one climb, so no band is unreachable', () => {
		const seen = new Set<string>();
		for (let t = 0; t < CLIMB_PERIOD_SEC; t += 5) {
			seen.add(resolveAtmosphere(altitudeAt(t)).bandId);
		}
		for (const band of ATMOSPHERE_BANDS) expect(seen).toContain(band.id);
	});

	it('stays inside the authored envelope', () => {
		for (let t = 0; t < CLIMB_PERIOD_SEC; t += 3) {
			const a = altitudeAt(t);
			expect(a).toBeGreaterThanOrEqual(ALTITUDE_FLOOR_M - 1e-6);
			expect(a).toBeLessThanOrEqual(ALTITUDE_CEILING_M + 1e-6);
		}
		expect(altitudeAt(Number.NaN)).toBe(ALTITUDE_FLOOR_M);
	});
});
