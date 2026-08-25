import { describe, it, expect } from 'vitest';
import { selectImagery, selectDetailLevel, type ImagerySelection } from '#lib/world/imagery.js';
import { IMAGERY_SOURCES } from '#content/imagery/sources.js';
import { resolveAtmosphere } from '#lib/world/atmosphere.js';

const DAY = 0;
const NIGHT = 1;
const day = IMAGERY_SOURCES.find((s) => s.nightAnchor === 0)!;

describe('selectImagery', () => {
	it('picks the day source by day and the night source by night', () => {
		expect(selectImagery({ groundDetail: 1, nightFactor: DAY, current: null }).sourceId).toBe(
			'esri-world-imagery',
		);
		expect(selectImagery({ groundDetail: 1, nightFactor: NIGHT, current: null }).sourceId).toBe(
			'cartodb-dark',
		);
	});

	it('never requests deeper than the packs actually hold', () => {
		// Above z12 the offline packs have nothing; Cesium would upsample blur.
		for (let g = 0; g <= 1.0001; g += 0.05) {
			for (const nf of [DAY, NIGHT]) {
				const sel = selectImagery({ groundDetail: g, nightFactor: nf, current: null });
				const src = IMAGERY_SOURCES.find((s) => s.id === sel.sourceId)!;
				expect(sel.maximumLevel).toBeGreaterThanOrEqual(src.zoomRange[0]);
				expect(sel.maximumLevel).toBeLessThanOrEqual(src.zoomRange[1]);
			}
		}
	});

	it('spends less detail at cruise than on the ground', () => {
		const low = selectImagery({
			groundDetail: resolveAtmosphere(300).groundDetail,
			nightFactor: DAY,
			current: null,
		});
		const cruise = selectImagery({
			groundDetail: resolveAtmosphere(11_600).groundDetail,
			nightFactor: DAY,
			current: null,
		});
		expect(cruise.maximumLevel).toBeLessThan(low.maximumLevel);
	});

	it('does not flip the base texture back and forth at the day/night crossover', () => {
		// A bare threshold would retile the globe repeatedly while nightFactor
		// hovers, and three panes would not flip on the same frame.
		let current: ImagerySelection | null = selectImagery({
			groundDetail: 1,
			nightFactor: 0.45,
			current: null,
		});
		const first = current.sourceId;
		let swaps = 0;
		for (const nf of [0.5, 0.48, 0.52, 0.49, 0.51, 0.5, 0.47]) {
			const next: ImagerySelection = selectImagery({
				groundDetail: 1,
				nightFactor: nf,
				current,
			});
			if (next.sourceId !== current.sourceId) swaps++;
			current = next;
		}
		expect(swaps).toBe(0);
		expect(current.sourceId).toBe(first);
	});

	it('still swaps once night is unambiguous', () => {
		const dayPick = selectImagery({ groundDetail: 1, nightFactor: 0.1, current: null });
		const nightPick = selectImagery({ groundDetail: 1, nightFactor: 0.95, current: dayPick });
		expect(nightPick.sourceId).not.toBe(dayPick.sourceId);
	});

	it('holds the zoom cap against sub-step jitter, but yields to a real change', () => {
		const held = selectDetailLevel(day, 0.5, 8);
		expect(held).toBe(8); // target ~8 — no reason to retile

		const moved = selectDetailLevel(day, 0.0, 8);
		expect(moved).toBeLessThan(8); // climbed out of legibility: step down
	});

	it('recomputes the level from scratch when the source changes under it', () => {
		// A cap measured against one source's zoom range means nothing against
		// another's, so it must not be carried across a swap.
		const dayPick = selectImagery({ groundDetail: 0.2, nightFactor: 0.0, current: null });
		const forced: ImagerySelection = { ...dayPick, maximumLevel: 12 };
		const nightPick = selectImagery({ groundDetail: 0.2, nightFactor: 1.0, current: forced });
		expect(nightPick.sourceId).not.toBe(forced.sourceId);
		expect(nightPick.maximumLevel).toBeLessThan(12);
	});

	it('is deterministic and total — the 3-Pi wall depends on both', () => {
		for (const bad of [Number.NaN, -1, 2, Number.POSITIVE_INFINITY]) {
			const a = selectImagery({ groundDetail: bad, nightFactor: bad, current: null });
			const b = selectImagery({ groundDetail: bad, nightFactor: bad, current: null });
			expect(a).toEqual(b);
			expect(Number.isFinite(a.maximumLevel)).toBe(true);
		}
	});
});
