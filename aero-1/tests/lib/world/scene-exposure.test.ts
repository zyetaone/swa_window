import { describe, it, expect } from 'vitest';
import { sceneExposure } from '$lib/world/atmosphere';

describe('sceneExposure', () => {
	it('passes base through at neutral brightness and no warp', () => {
		expect(sceneExposure(1.0, 1.0, 0)).toBeCloseTo(1.0, 5);
	});

	it('scales by sky×weather filterBrightness', () => {
		// dusk 0.95 × storm 0.85
		expect(sceneExposure(1.0, 0.95 * 0.85, 0)).toBeCloseTo(0.8075, 5);
	});

	it('lifts exposure during warp (replaces CSS warp brightness)', () => {
		expect(sceneExposure(1.0, 1.0, 1)).toBeCloseTo(1.25, 5);
		// below threshold: no lift
		expect(sceneExposure(1.0, 1.0, 0.01)).toBeCloseTo(1.0, 5);
	});

	it('treats non-finite brightness as 1', () => {
		expect(sceneExposure(0.8, Number.NaN, 0)).toBeCloseTo(0.8, 5);
	});
});
