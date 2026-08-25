import { describe, it, expect, vi } from 'vitest';
import { AeroWindow } from '#lib/window/aero-window.svelte.js';
import { Location } from '#lib/world/locations.js';
import { resolveLocalHours } from '#lib/flight/clock.js';

describe('AeroWindow', () => {
	it('frame() carries the primaries the world derives from', () => {
		const model = new AeroWindow();
		model.tick();
		const frame = model.frame();
		expect(frame.camera.lat).toBeTypeOf('number');
		expect(frame.camera.lon).toBeTypeOf('number');
		// The slice carries primaries only — the world derives the rest.
		expect(frame.camera.altitudeM).toBe(model.flight.altitudeM);
		expect(frame.timeOfDay).toBe(model.flight.timeOfDay);
	});

	it('tick advances position over wall time', () => {
		const model = new AeroWindow();
		const lat0 = model.flight.lat;
		model.tick();
		expect(model.flight.lat).not.toBe(lat0);
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
		const model = new AeroWindow(Location.hyderabad(), -90);
		model.tick();
		const track = model.flight.headingDeg;
		const looking = model.frame().camera.headingDeg;
		const delta = ((((looking - track) % 360) + 540) % 360) - 180;
		expect(delta).toBeCloseTo(-90, 6);
	});

	it('wraps rather than emitting a negative heading', () => {
		const model = new AeroWindow(Location.hyderabad(), -270);
		model.tick();
		const h = model.frame().camera.headingDeg;
		expect(h).toBeGreaterThanOrEqual(0);
		expect(h).toBeLessThan(360);
	});

	it('a pane offset is the only per-screen difference', () => {
		// Three panes, one aircraft: SAME INSTANT, three azimuths. The time has to
		// be pinned - pose is a pure function of Date.now(), so ticking three
		// windows across a millisecond boundary legitimately yields three
		// positions. That is the invariant working, not breaking, and this test
		// flaked until it stopped straddling real time.
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-25T09:30:00Z'));
		try {
			const panes = [-105, -90, -75].map((az) => {
				const m = new AeroWindow(Location.hyderabad(), az);
				m.tick();
				return m.frame();
			});
			expect(panes[1].camera.lat).toBe(panes[0].camera.lat);
			expect(panes[2].camera.altitudeM).toBe(panes[0].camera.altitudeM);
			expect(panes[1].camera.headingDeg).not.toBe(panes[0].camera.headingDeg);
		} finally {
			vi.useRealTimers();
		}
	});

	it('same wall-clock instant, independent instances, identical pose', () => {
		// The fleet invariant itself: three Pis are three processes that share
		// nothing but the clock. Construction order and object identity must not
		// leak into the pose.
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-25T17:45:12.345Z'));
		try {
			const a = new AeroWindow(Location.hyderabad(), -90);
			const b = new AeroWindow(Location.hyderabad(), -90);
			a.tick();
			b.tick();
			expect(b.frame().camera).toEqual(a.frame().camera);
		} finally {
			vi.useRealTimers();
		}
	});
});
