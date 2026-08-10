/**
 * Fog visualDensityScalar — pins the 0.15 Cesium baseline fix.
 */
import { describe, it, expect } from 'vitest';
import { fogVisualDensityScalar } from '$lib/world/atmosphere';

describe('fogVisualDensityScalar', () => {
	it('day clear sits near Cesium stock (0.15), not ~1.0', () => {
		expect(fogVisualDensityScalar(0, 0)).toBeCloseTo(0.15, 5);
	});

	it('night is sharper but still far below the old ~1.9 unscaled day value', () => {
		const night = fogVisualDensityScalar(1, 0);
		expect(night).toBeCloseTo(0.15 * 1.9, 5);
		expect(night).toBeLessThan(0.5);
	});

	it('haze raises scalar without blowing past 1 at max authored haze', () => {
		const hazy = fogVisualDensityScalar(0, 0.15);
		expect(hazy).toBeCloseTo(0.15 * (1 + 0.6), 5);
		expect(hazy).toBeLessThan(0.4);
	});
});
