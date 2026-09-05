/**
 * EpsilonGate — pin the write semantics.
 *
 * The gate is load-bearing: atmosphere, buildings, imagery, and terrain
 * all depend on it to skip redundant Cesium setter calls. A bug here
 * means either (a) every frame re-writes the same value (~60 GPU syncs/sec
 * for nothing) or (b) a viewer remount never picks up model state
 * (gates hold stale "last-applied" values from the dead viewer).
 *
 * Constructor stores `init` as the first "last-applied" value (NOT a
 * sentinel). reset() seeds NaN for numbers / Symbol for objects so the
 * next update() is guaranteed to write regardless of the incoming value.
 */
import { describe, it, expect } from 'vitest';
import { EpsilonGate } from '$lib/world/util';

describe('EpsilonGate', () => {
	describe('constructor seeding', () => {
		it('writes on the first update when value differs from init', () => {
			let written: number | undefined;
			const gate = new EpsilonGate<number>(0.01, -1);
			gate.update(0.5, (v) => { written = v; });
			expect(written).toBe(0.5);
		});

		it('skips the first update when value equals init', () => {
			// Constructor stores init as last-applied — no sentinel at
			// construction time. So a value matching init is treated as
			// "unchanged" and skipped. This is by design: the init value
			// represents the Cesium default the viewer was constructed with.
			let calls = 0;
			const gate = new EpsilonGate<number>(0.01, 0.5);
			gate.update(0.5, () => { calls++; });
			expect(calls).toBe(0);
		});
	});

	describe('epsilon threshold (numbers)', () => {
		it('skips writes within epsilon', () => {
			let calls = 0;
			const gate = new EpsilonGate<number>(0.05, 0);
			gate.update(0.5, () => { calls++; });  // write (differs from init 0)
			gate.update(0.52, () => { calls++; }); // |Δ|=0.02 < 0.05 → skip
			expect(calls).toBe(1);
		});

		it('writes when delta exceeds epsilon', () => {
			let calls = 0;
			const gate = new EpsilonGate<number>(0.05, 0);
			gate.update(0.5, () => { calls++; });
			gate.update(0.56, () => { calls++; }); // |Δ|=0.06 > 0.05 → write
			expect(calls).toBe(2);
		});

		it('tracks last-applied after a skip so the next divergence writes', () => {
			let calls = 0;
			const gate = new EpsilonGate<number>(0.05, 0);
			gate.update(0.5, () => { calls++; });   // write, last=0.5
			gate.update(0.52, () => { calls++; });  // skip (0.02 < 0.05), last stays 0.5
			gate.update(0.56, () => { calls++; });  // |0.56-0.5|=0.06 > 0.05 → write
			expect(calls).toBe(2);
		});
	});

	describe('reference equality (non-numbers)', () => {
		it('writes when object identity changes', () => {
			let calls = 0;
			const gate = new EpsilonGate<{ r: number }>(0, { r: 0 });
			gate.update({ r: 1 }, () => { calls++; }); // first, differs from init → write
			gate.update({ r: 1 }, () => { calls++; }); // different object → write
			expect(calls).toBe(2);
		});

		it('skips when the same object reference is passed again', () => {
			let calls = 0;
			const obj = { r: 1 };
			const gate = new EpsilonGate<{ r: number }>(0, { r: 0 });
			gate.update(obj, () => { calls++; }); // write (differs from init)
			gate.update(obj, () => { calls++; }); // same ref → skip
			expect(calls).toBe(1);
		});

		it('uses strict inequality for booleans', () => {
			let calls = 0;
			const gate = new EpsilonGate<boolean>(0, false);
			gate.update(true, () => { calls++; });  // differs from init false → write
			gate.update(true, () => { calls++; });  // same → skip
			gate.update(false, () => { calls++; }); // changed → write
			expect(calls).toBe(2);
		});
	});

	describe('reset() — force-write on next update', () => {
		it('forces the next update() to write even if value is unchanged', () => {
			let calls = 0;
			const gate = new EpsilonGate<number>(0.01, 0);
			gate.update(0.5, () => { calls++; }); // write
			gate.update(0.5, () => { calls++; }); // skip (same value)
			expect(calls).toBe(1);
			gate.reset();
			gate.update(0.5, () => { calls++; }); // reset → write (NaN sentinel)
			expect(calls).toBe(2);
		});

		it('reset works for numeric gates (NaN sentinel bypasses epsilon check)', () => {
			// This is the bug fix: previously Math.abs(NaN - x) > epsilon
			// returned NaN (falsy), so reset() was a no-op for numbers.
			let written: number | undefined;
			const gate = new EpsilonGate<number>(0.01, 42);
			gate.update(42, (v) => { written = v; }); // init=42, value=42 → skip
			expect(written).toBeUndefined();
			gate.reset();
			gate.update(42, (v) => { written = v; }); // reset → NaN sentinel → write
			expect(written).toBe(42);
		});

		it('reset works for boolean gates (Symbol sentinel bypasses ===)', () => {
			let written: boolean | undefined;
			const gate = new EpsilonGate<boolean>(0, true);
			gate.update(true, (v) => { written = v; }); // init=true, value=true → skip
			expect(written).toBeUndefined();
			gate.reset();
			gate.update(true, (v) => { written = v; }); // reset → Symbol sentinel → write
			expect(written).toBe(true);
		});
	});
});
