/**
 * Three.js cloud cluster budgets from authored density (0..1).
 *
 * Counts scale with density (not a high floor + small offset). dens=0 is
 * sparse so clear weather can read empty; dens=1 matches the prior storm
 * budget (95 distant / 32 close) so the Pi worst-case sprite load is unchanged.
 *
 * Callers draw clusters from a sequential seeded rng — a lower dens is a
 * strict PREFIX of the dens=1 field (3-Pi identical at the same dens).
 */
import { clamp } from '$lib/utils';

export function clusterCountsForDensity(dens: number): { distant: number; close: number } {
	const d = clamp(dens, 0, 1);
	return {
		distant: Math.round(8 + d * 87),
		close: Math.round(3 + d * 29),
	};
}
