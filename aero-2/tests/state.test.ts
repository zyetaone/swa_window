import { describe, it, expect } from 'vitest';
import { AeroWindow } from '#lib/window/aero-window.svelte.js';
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
			now: new Date('2026-01-15T12:00:00Z'),
		});
		expect(h).toBeCloseTo(12, 1);
	});
});
