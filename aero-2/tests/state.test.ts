import { describe, it, expect, vi } from 'vitest';
import { altitudeAt, normalizeHeading, orbitPose } from '#lib/flight/rules.js';
import { lookTarget } from '#lib/experience/probe-camera.js';
import { Location } from '#lib/world/locations.js';
import { resolveLocalHours } from '#lib/flight/clock.js';
import { ORBIT } from '#lib/window/config.js';

/**
 * Mirrors the per-frame composition in routes/+page.svelte, so these tests
 * exercise the actual live path rather than a stand-in. There is no class
 * wrapping this any more — the window IS this function, called once a frame.
 */
function frameAt(wallT: number, place = Location.hyderabad(), azimuthDeg = -90, pitchDeg = -18) {
	const pose = orbitPose({
		wallT,
		centerLat: place.lat,
		centerLon: place.lon,
		orbitAngle0: 0.5,
		orbitBearingRad: 0,
		direction: 1,
		...ORBIT
	});
	const aglM = altitudeAt(wallT, place.climbFloorM, place.climbCeilingM);
	const windowHeadingDeg = normalizeHeading(pose.headingDeg + azimuthDeg);
	const target = lookTarget(pose.lat, pose.lon, aglM, windowHeadingDeg, pitchDeg);
	return { pose, aglM, windowHeadingDeg, target };
}

describe('frameAt', () => {
	it('produces finite, in-range numbers', () => {
		const { pose, aglM, windowHeadingDeg } = frameAt(1_787_650_000);
		expect(pose.lat).toBeTypeOf('number');
		expect(pose.lon).toBeTypeOf('number');
		expect(Number.isFinite(aglM)).toBe(true);
		expect(windowHeadingDeg).toBeGreaterThanOrEqual(0);
		expect(windowHeadingDeg).toBeLessThan(360);
	});
});

describe('resolveLocalHours', () => {
	it('resolves a known IANA zone', () => {
		const h = resolveLocalHours({
			timeZone: 'UTC',
			now: new Date('2026-01-15T12:00:00Z')
		});
		expect(h).toBeCloseTo(12, 1);
	});
});

describe('window azimuth', () => {
	it('looks out of the side, not down the track — this is a window, not a windscreen', () => {
		const { pose, windowHeadingDeg } = frameAt(1_787_650_000, Location.hyderabad(), -90);
		const delta = ((((windowHeadingDeg - pose.headingDeg) % 360) + 540) % 360) - 180;
		expect(delta).toBeCloseTo(-90, 6);
	});

	it('wraps rather than emitting a negative heading', () => {
		const { windowHeadingDeg } = frameAt(1_787_650_000, Location.hyderabad(), -270);
		expect(windowHeadingDeg).toBeGreaterThanOrEqual(0);
		expect(windowHeadingDeg).toBeLessThan(360);
	});

	it('a pane offset is the only per-screen difference', () => {
		// Three panes, one aircraft: SAME INSTANT, three azimuths. The time has to
		// be pinned - pose is a pure function of Date.now(), so ticking three
		// windows across a millisecond boundary legitimately yields three
		// positions. That is the invariant working, not breaking, and this test
		// flaked until it stopped straddling real time.
		const wallT = new Date('2026-08-25T09:30:00Z').getTime() / 1000;
		const panes = [-105, -90, -75].map((az) => frameAt(wallT, Location.hyderabad(), az));
		expect(panes[1].pose.lat).toBe(panes[0].pose.lat);
		expect(panes[2].aglM).toBe(panes[0].aglM);
		expect(panes[1].windowHeadingDeg).not.toBe(panes[0].windowHeadingDeg);
	});

	it('same wall-clock instant, independent calls, identical pose', () => {
		// The fleet invariant itself: three Pis are three processes that share
		// nothing but the clock. Call order must not leak into the pose.
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-25T17:45:12.345Z'));
		try {
			const wallT = Date.now() / 1000;
			const a = frameAt(wallT);
			const b = frameAt(wallT);
			expect(b).toEqual(a);
		} finally {
			vi.useRealTimers();
		}
	});
});
