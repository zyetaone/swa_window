import { describe, it, expect } from 'vitest';
import { AeroWindow } from '#lib/model/aero-window.js';
import { resolveAtmosphere } from '#lib/world/atmosphere.js';

describe('AeroWindow', () => {
	it('frame() exposes camera and atmosphere for world sync', () => {
		const model = new AeroWindow();
		model.tick(0);
		const frame = model.frame();
		expect(frame.camera.lat).toBeTypeOf('number');
		expect(frame.camera.lon).toBeTypeOf('number');
		expect(frame.atmosphere).toEqual(resolveAtmosphere(model.config.camera.view.altitudeM));
	});

	it('tick advances position over wall time', () => {
		const model = new AeroWindow();
		const lat0 = model.flight.lat;
		model.tick(0.016);
		expect(model.flight.lat).not.toBe(lat0);
	});
});
