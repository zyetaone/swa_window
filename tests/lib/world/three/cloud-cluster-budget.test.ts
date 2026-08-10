import { describe, it, expect } from 'vitest';
import { clusterCountsForDensity } from '$lib/world/three/cloud-cluster-budget';

describe('clusterCountsForDensity', () => {
	it('is sparse at dens=0 (clear sky can author empty)', () => {
		expect(clusterCountsForDensity(0)).toEqual({ distant: 8, close: 3 });
	});

	it('matches prior storm budget at dens=1 (Pi worst-case unchanged)', () => {
		expect(clusterCountsForDensity(1)).toEqual({ distant: 95, close: 32 });
	});

	it('scales between and clamps outside 0..1', () => {
		const mid = clusterCountsForDensity(0.3);
		expect(mid.distant).toBe(Math.round(8 + 0.3 * 87));
		expect(mid.close).toBe(Math.round(3 + 0.3 * 29));
		expect(clusterCountsForDensity(-1)).toEqual(clusterCountsForDensity(0));
		expect(clusterCountsForDensity(2)).toEqual(clusterCountsForDensity(1));
	});

	it('never exceeds dens=1 budget', () => {
		const max = clusterCountsForDensity(1);
		for (const d of [0, 0.1, 0.5, 0.99]) {
			const c = clusterCountsForDensity(d);
			expect(c.distant).toBeLessThanOrEqual(max.distant);
			expect(c.close).toBeLessThanOrEqual(max.close);
		}
	});
});
