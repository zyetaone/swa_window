import { describe, it, expect } from 'vitest';
import { clamp01, engineCutoffHz } from '../src/lib/display/media/ambient-audio.js';

describe('ambient-audio math', () => {
	it('clamps volume inputs safely without NaN poisoning', () => {
		expect(clamp01(0.5)).toBe(0.5);
		expect(clamp01(-0.2)).toBe(0);
		expect(clamp01(1.5)).toBe(1);
		expect(clamp01(NaN)).toBe(0);
	});

	it('computes realistic altitude-dependent engine lowpass cutoff frequency', () => {
		expect(engineCutoffHz(0)).toBe(220);
		expect(engineCutoffHz(12_000)).toBe(110);
		expect(engineCutoffHz(6_000)).toBe(165);
		expect(engineCutoffHz(NaN)).toBe(220);
	});
});
