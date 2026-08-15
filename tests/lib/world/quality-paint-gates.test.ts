/**
 * Pi lean: under qualityMode=performance, day grade must not keep postFx
 * on. Night bloom/hash still run via nightFx.
 */
import { describe, it, expect } from 'vitest';
import { qualityPaintGates } from '../../../src/lib/world/shaders';

const DAY_KNOBS = { dayContrast: 0.35, dayVibrance: 0.20 };

describe('qualityPaintGates', () => {
	it('performance + day: no shadows/FXAA, no day grade, no postFx', () => {
		const g = qualityPaintGates({
			mode: 'performance',
			nightFx: false,
			...DAY_KNOBS,
		});
		expect(g.quality).toBe(false);
		expect(g.gradeByDay).toBe(false);
		expect(g.bloomOn).toBe(false);
		expect(g.postFx).toBe(false);
	});

	it('performance + night: bloom + postFx on (hash/bloom stay load-bearing)', () => {
		const g = qualityPaintGates({
			mode: 'performance',
			nightFx: true,
			...DAY_KNOBS,
		});
		expect(g.quality).toBe(false);
		expect(g.gradeByDay).toBe(false);
		expect(g.bloomOn).toBe(true);
		expect(g.postFx).toBe(true);
	});

	it('balanced + day knobs: day grade and postFx on', () => {
		const g = qualityPaintGates({
			mode: 'balanced',
			nightFx: false,
			...DAY_KNOBS,
		});
		expect(g.quality).toBe(true);
		expect(g.gradeByDay).toBe(true);
		expect(g.bloomOn).toBe(true);
		expect(g.postFx).toBe(true);
	});

	it('balanced + zero day knobs + day: gradeByDay off (bloom still on via quality)', () => {
		const g = qualityPaintGates({
			mode: 'balanced',
			nightFx: false,
			dayContrast: 0,
			dayVibrance: 0,
		});
		expect(g.quality).toBe(true);
		expect(g.gradeByDay).toBe(false);
		expect(g.bloomOn).toBe(true);
		expect(g.postFx).toBe(true);
	});

	it('ultra matches balanced for gate shape', () => {
		const bal = qualityPaintGates({ mode: 'balanced', nightFx: false, ...DAY_KNOBS });
		const ult = qualityPaintGates({ mode: 'ultra', nightFx: false, ...DAY_KNOBS });
		expect(ult).toEqual(bal);
	});
});
