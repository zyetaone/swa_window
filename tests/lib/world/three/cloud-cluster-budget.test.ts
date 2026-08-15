import { describe, it, expect } from 'vitest';
import {
	clusterCountsForDensity,
	drawCluster,
	PERFORMANCE_CLOUD_COUNT_SCALE,
} from '$lib/world/three/cloud-cluster-budget';
import { createSeededRng } from '$lib/world/prng';

describe('clusterCountsForDensity', () => {
	it('is sparse at dens=0 (clear sky can author empty)', () => {
		expect(clusterCountsForDensity(0)).toEqual({ distant: 8, close: 3 });
	});

	it('matches full storm budget at dens=1 when not in performance mode', () => {
		expect(clusterCountsForDensity(1)).toEqual({ distant: 95, close: 32 });
	});

	it('scales counts down under performance (Pi lean, wing still mounted)', () => {
		const full = clusterCountsForDensity(1);
		const lean = clusterCountsForDensity(1, { performance: true });
		expect(lean.distant).toBe(Math.max(1, Math.round(full.distant * PERFORMANCE_CLOUD_COUNT_SCALE)));
		expect(lean.close).toBe(Math.max(0, Math.round(full.close * PERFORMANCE_CLOUD_COUNT_SCALE)));
		expect(lean.distant).toBeLessThan(full.distant);
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

/**
 * drawCluster — the strict-PREFIX seam invariant.
 *
 * The 3-Pi panorama relies on "lower density = strict PREFIX of the same
 * seeded field": density changes only how MANY clusters Clouds.svelte
 * emits, never WHAT a cluster draws. A refactor that made per-cluster
 * draws (e.g. spriteCount) density-dependent would silently break the
 * seam with every count/clamp test above still green — these tests pin
 * the consumption pattern itself. Band arguments mirror the call sites
 * in Clouds.svelte buildClusters() on purpose: a retune must update
 * this pin deliberately.
 */
const DISTANT_ARGS = [42_000, 265_000, 8_000, 16_000, 9, 8, 0.03] as const;
const CLOSE_ARGS = [1_500, 30_000, 1_500, 3_000, 4, 7, 0.10] as const;
const SEED = 20260812;

/** Mirror of Clouds.svelte buildClusters' emission loops (one shared stream). */
function buildField(dens: number, seed: number) {
	const { distant, close } = clusterCountsForDensity(dens);
	const rng = createSeededRng(seed);
	const clusters = [];
	for (let c = 0; c < distant; c++) clusters.push(drawCluster(...DISTANT_ARGS, rng));
	for (let c = 0; c < close; c++) clusters.push(drawCluster(...CLOSE_ARGS, rng));
	return clusters;
}

describe('drawCluster — strict-prefix determinism (3-Pi seam)', () => {
	it('same seed + same density → identical field on every Pi', () => {
		for (const dens of [0.05, 0.3, 0.85, 1]) {
			expect(buildField(dens, SEED)).toEqual(buildField(dens, SEED));
		}
	});

	it('dens=0.3 distant band is a strict PREFIX of the dens=1 field', () => {
		const low = clusterCountsForDensity(0.3);
		const full = clusterCountsForDensity(1);
		expect(low.distant).toBeLessThan(full.distant);

		const lowField = buildField(0.3, SEED);
		const fullField = buildField(1.0, SEED);
		// One shared rng serves distant then close, so the prefix holds over
		// the DISTANT band exactly; the close band starts at a different
		// stream position per density and is only pinned identical at the
		// SAME density (the test above).
		expect(fullField.slice(0, low.distant)).toEqual(lowField.slice(0, low.distant));
	});

	it('per-band streams make each band a prefix at any density', () => {
		// With a band-local rng the prefix property covers the close band too
		// — this pins that drawCluster itself is count-independent, with no
		// hidden dependence on how many clusters follow.
		const rngFull = createSeededRng(SEED);
		const full = Array.from({ length: 32 }, () => drawCluster(...CLOSE_ARGS, rngFull));
		const rngLow = createSeededRng(SEED);
		const low = Array.from({ length: 12 }, () => drawCluster(...CLOSE_ARGS, rngLow));
		expect(low).toEqual(full.slice(0, 12));
	});

	it('consumes 6 draws for a lonely cluster, 7 otherwise — never density-driven', () => {
		// The draw sequence is theta, radius, height, baseScale, loneliness,
		// [spriteCount], shear. Only the spriteCount draw is conditional, and
		// ONLY on the loneliness flip — nothing else may gate a draw, or the
		// prefix property above breaks.
		let draws = 0;
		const counting = (rng: () => number) => () => { draws++; return rng(); };

		// Scan a stream until both branch shapes have been observed.
		const rng = counting(createSeededRng(SEED));
		let sawLonely = false, sawFull = false;
		for (let k = 0; k < 200 && !(sawLonely && sawFull); k++) {
			draws = 0;
			const c = drawCluster(...DISTANT_ARGS, rng);
			if (c.spriteCount === 1) {
				expect(draws).toBe(6);
				sawLonely = true;
			} else {
				expect(draws).toBe(7);
				sawFull = true;
			}
		}
		expect(sawLonely && sawFull).toBe(true); // both branches exercised
	});

	it('stays inside the authored band ranges', () => {
		const rng = createSeededRng(SEED);
		for (let k = 0; k < 100; k++) {
			const c = drawCluster(...DISTANT_ARGS, rng);
			const radius = Math.hypot(c.cx, c.cz);
			expect(radius).toBeGreaterThanOrEqual(42_000);
			expect(radius).toBeLessThanOrEqual(42_000 + 265_000);
			expect(c.spriteCount).toBeGreaterThanOrEqual(1);
			expect(c.spriteCount).toBeLessThanOrEqual(9 + 8);
			expect(Math.abs(c.shear)).toBeLessThanOrEqual(0.15 + 1e-12);
		}
	});
});
