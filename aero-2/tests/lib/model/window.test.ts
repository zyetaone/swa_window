import { describe, it, expect } from 'vitest';
import { WindowModel } from '#lib/model/window.svelte.js';
import { camera } from '#lib/model/config.svelte.js';
import { resolveAtmosphere } from '#lib/world/atmosphere.js';

describe('WindowModel', () => {
	it('frame() exposes camera and atmosphere for world sync', () => {
		const model = new WindowModel();
		model.tick(0);
		const frame = model.frame();
		expect(frame.camera.lat).toBeTypeOf('number');
		expect(frame.camera.lon).toBeTypeOf('number');
		expect(frame.atmosphere).toEqual(resolveAtmosphere(camera.view.altitudeM));
	});

	it('tick advances position over wall time', () => {
		const model = new WindowModel();
		const lat0 = model.lat;
		model.tick(0.016);
		expect(model.lat).not.toBe(lat0);
	});
});
