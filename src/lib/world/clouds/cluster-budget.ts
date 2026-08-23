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

/**
 * Scale applied under world.qualityMode === 'performance' (Pi default).
 * Keeps wing/Three mounted (product decision: wing on fielded Pis) while
 * cutting sprite load ~45%. dens=1 worst case was the Pi budget ceiling.
 */
export const PERFORMANCE_CLOUD_COUNT_SCALE = 0.55;

export function clusterCountsForDensity(
	dens: number,
	opts?: { performance?: boolean },
): { distant: number; close: number } {
	const d = clamp(dens, 0, 1);
	const scale = opts?.performance ? PERFORMANCE_CLOUD_COUNT_SCALE : 1;
	return {
		// At least 1 distant cluster so the field never goes fully empty mid-day
		// when dens is low and performance scale is on.
		distant: Math.max(1, Math.round((8 + d * 87) * scale)),
		close: Math.max(0, Math.round((3 + d * 29) * scale)),
	};
}

/** One cluster's placement draws from the seeded stream. */
export interface ClusterDraw {
	cx: number;
	cz: number;
	ch: number;
	baseScale: number;
	spriteCount: number;
	shear: number;
}

/**
 * Draw ONE cluster's header parameters from `rng`.
 *
 * ─── ⚠ COUNT-INDEPENDENCE IS LOAD-BEARING (3-Pi seam) ────────────────────
 * This function takes NO density and NO cluster index: every cluster
 * consumes the same fixed draw sequence (theta, radius, height, baseScale,
 * loneliness, sprite count, shear) no matter how many clusters the caller
 * will emit. That is exactly what makes "lower density = strict PREFIX of
 * the same seeded field" true: clusterCountsForDensity changes only how
 * MANY times Clouds.svelte calls this, never WHAT a call draws. Pinned by
 * the prefix test in tests/lib/world/clouds/cluster-budget.test.ts —
 * if per-cluster draws ever become density-dependent, that test and the
 * 3-Pi seam contract must change together.
 */
export function drawCluster(
	radiusMin: number, radiusSpan: number,
	baseScaleMin: number, baseScaleSpan: number,
	spriteMin: number, spriteSpan: number,
	lonelyChance: number,
	rng: () => number,
): ClusterDraw {
	const theta = rng() * Math.PI * 2;
	const r = radiusMin + Math.sqrt(rng()) * radiusSpan;
	const ch = (rng() - 0.18) * 4600;

	const baseScale = baseScaleMin + rng() * baseScaleSpan;
	const isLonely = rng() < lonelyChance;
	const spriteCount = isLonely ? 1 : spriteMin + Math.floor(rng() * spriteSpan);

	// Single shear factor for the whole cluster — applied to every sprite
	// in it. Range [-0.15, +0.15]; positive = drifts with gust, negative =
	// against. Adjacent clusters have independent shears so the deck moves
	// with shear, not as a rigid disc. Amplitude pulled back from ±0.4
	// (which had clusters effectively swapping positions over 30 min —
	// 2.33× rate ratio between fastest and slowest). ±0.15 keeps the shear
	// visible (rate ratio 1.35× fastest/slowest) without long-session drift.
	const shear = (rng() - 0.5) * 0.30;

	return { cx: Math.cos(theta) * r, cz: -Math.sin(theta) * r, ch, baseScale, spriteCount, shear };
}
