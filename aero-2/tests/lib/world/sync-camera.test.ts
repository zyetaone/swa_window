import { describe, it, expect } from 'vitest';
import { syncCamera, createCameraSyncScratch } from '#lib/world/sync-camera.js';

describe('syncCamera', () => {
	it('exports scratch factory for modular init', () => {
		const fakeCesium = {
			Cartesian3: class {
				static fromDegrees() {}
			},
		};
		expect(createCameraSyncScratch(fakeCesium as never)).toHaveProperty('position');
	});

	it('is a function', () => {
		expect(typeof syncCamera).toBe('function');
	});
});
