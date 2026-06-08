/**
 * Coverage for the deterministic PRNG used by the visual layer.
 *
 * The 3-Pi panorama continuity guarantee depends on `daySeed()` returning
 * the same value across all three Pi screens on the same day, AND on
 * `createSeededRng(seed)` producing identical streams for identical seeds.
 * These tests pin that contract so any future "optimization" that breaks
 * determinism surfaces as a CI signal.
 */
import { describe, it, expect } from 'vitest';
import { createSeededRng, daySeed, spherePoint } from '$lib/world-three/prng';

describe('createSeededRng', () => {
	it('produces uniform [0, 1) values', () => {
		const rng = createSeededRng(42);
		for (let i = 0; i < 1000; i++) {
			const v = rng();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});
	it('same seed → identical stream (the 3-Pi continuity contract)', () => {
		const a = createSeededRng(12345);
		const b = createSeededRng(12345);
		for (let i = 0; i < 100; i++) {
			expect(a()).toBe(b());
		}
	});
	it('different seed → different stream', () => {
		const a = createSeededRng(1);
		const b = createSeededRng(2);
		let same = 0;
		for (let i = 0; i < 100; i++) {
			if (a() === b()) same++;
		}
		expect(same).toBeLessThan(5); // overwhelmingly different
	});
	it('two independent generators with same seed do not interfere', () => {
		// Each createSeededRng returns its own closed state. Calling one
		// must not advance the other.
		const a = createSeededRng(99);
		const b = createSeededRng(99);
		const aFirst = a();
		const bFirst = b();
		expect(aFirst).toBe(bFirst);
		const aSecond = a();
		const bSecond = b();
		expect(aSecond).toBe(bSecond);
	});
});

describe('daySeed', () => {
	it('returns the same value for two calls on the same day', () => {
		const morning = new Date(Date.UTC(2026, 5, 15, 6, 0, 0));
		const evening = new Date(Date.UTC(2026, 5, 15, 20, 0, 0));
		expect(daySeed(morning)).toBe(daySeed(evening));
	});
	it('returns different values on successive days', () => {
		const day1 = new Date(Date.UTC(2026, 5, 15));
		const day2 = new Date(Date.UTC(2026, 5, 16));
		expect(daySeed(day1)).not.toBe(daySeed(day2));
	});
	it('returns different values across years (collision guard)', () => {
		// Same day-of-year in two different years must differ — the
		// year * 1000 multiplier guarantees this.
		const a = new Date(Date.UTC(2025, 0, 1));
		const b = new Date(Date.UTC(2026, 0, 1));
		expect(daySeed(a)).not.toBe(daySeed(b));
	});
});

describe('spherePoint', () => {
	it('returns a point on the sphere of the given radius', () => {
		const rng = createSeededRng(7);
		for (let i = 0; i < 50; i++) {
			const [x, y, z] = spherePoint(rng, 100);
			const len = Math.sqrt(x * x + y * y + z * z);
			expect(len).toBeCloseTo(100, 5);
		}
	});
	it('is deterministic for the same seed sequence', () => {
		const r1 = createSeededRng(42);
		const r2 = createSeededRng(42);
		expect(spherePoint(r1, 50)).toEqual(spherePoint(r2, 50));
	});
});
