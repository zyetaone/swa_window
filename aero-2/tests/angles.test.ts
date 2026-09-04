import { describe, it, expect } from 'vitest';
import {
	normalizeHeading,
	wrapSigned,
	signedDelta,
	clamp01,
	DEG2RAD,
	RAD2DEG
} from '#lib/angles.js';

/**
 * Four hand-rolled copies of this arithmetic existed before this module —
 * flight-path, settings, sun, and an inlined `+540` variant in Sky. Modular
 * arithmetic on headings is where a copy drifts silently, and the bank-sign
 * inversion this codebase shipped lived one step from an unwritten bearing
 * convention. The functions are trivial; the AGREEMENT is the value.
 */
describe('angles', () => {
	it('normalizeHeading wraps to [0,360)', () => {
		expect(normalizeHeading(0)).toBe(0);
		expect(normalizeHeading(360)).toBe(0);
		expect(normalizeHeading(-90)).toBe(270);
		expect(normalizeHeading(725)).toBe(5);
	});

	it('wrapSigned wraps to [-180,180)', () => {
		expect(wrapSigned(0)).toBe(0);
		expect(wrapSigned(180)).toBe(-180);
		expect(wrapSigned(-180)).toBe(-180);
		expect(wrapSigned(190)).toBe(-170);
		expect(wrapSigned(-190)).toBe(170);
	});

	it('signedDelta takes the SHORT way round', () => {
		expect(signedDelta(350, 10)).toBe(20);
		expect(signedDelta(10, 350)).toBe(-20);
		expect(signedDelta(0, 180)).toBe(-180);
		expect(signedDelta(90, 90)).toBe(0);
	});

	it('the two wraps agree where their ranges overlap', () => {
		for (let d = -720; d <= 720; d += 7) {
			const h = normalizeHeading(d);
			const s = wrapSigned(d);
			expect(normalizeHeading(s), `disagree at ${d}`).toBeCloseTo(h, 10);
		}
	});

	it('clamp01 refuses NaN — the poisoning guard callers rely on', () => {
		expect(clamp01(0.5)).toBe(0.5);
		expect(clamp01(-1)).toBe(0);
		expect(clamp01(2)).toBe(1);
		expect(clamp01(NaN)).toBe(0);
		expect(clamp01(Infinity)).toBe(0);
	});

	it('constants are inverses', () => {
		expect(DEG2RAD * RAD2DEG).toBeCloseTo(1, 12);
	});
});
