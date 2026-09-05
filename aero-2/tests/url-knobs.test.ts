import { describe, it, expect } from 'vitest';
import { readSettings, KNOB_RANGE } from '#lib/settings/settings.svelte.js';

const read = (qs: string) => readSettings(new URL(`http://pane/?${qs}`));

describe('URL knobs vs KNOB_RANGE', () => {
	it('clamps a floor far below the ground', () => {
		const s = read('place=denver&floor=-999999');
		expect(s.floorM).toBeGreaterThanOrEqual(KNOB_RANGE.floorM[0]);
	});

	it('clamps a pitch past straight down', () => {
		const s = read('pitch=-9999');
		expect(s.pitchDeg).toBeGreaterThanOrEqual(KNOB_RANGE.pitchDeg[0]);
	});

	it('clamps speed to something a window can be watched at', () => {
		const s = read('speed=100000');
		expect(s.speed).toBeLessThanOrEqual(KNOB_RANGE.speed[1]);
	});

	it('clamps a clock offset outside a day', () => {
		const s = read('clock=99');
		expect(s.clockOffsetH).toBeLessThanOrEqual(KNOB_RANGE.clockOffsetH[1]);
	});

	it('clamps terrain exaggeration', () => {
		const s = read('exaggeration=500');
		expect(s.exaggeration).toBeLessThanOrEqual(KNOB_RANGE.exaggeration[1]);
	});
});

describe('clamping must not disturb legitimate values', () => {
	it('passes in-range params through untouched', () => {
		const s = read('place=denver&pitch=-12&speed=3.5&clock=-5&exaggeration=1.4&cloudDensity=0.8');
		expect(s.pitchDeg).toBe(-12);
		expect(s.speed).toBe(3.5);
		expect(s.clockOffsetH).toBe(-5);
		expect(s.exaggeration).toBe(1.4);
		expect(s.cloudDensity).toBe(0.8);
	});

	it('still falls back when a param is absent or unparseable', () => {
		const s = read('place=denver&pitch=banana');
		expect(Number.isFinite(s.pitchDeg)).toBe(true);
		expect(s.pitchDeg).toBeLessThanOrEqual(KNOB_RANGE.pitchDeg[1]);
	});

	it('keeps the place-derived envelope when no floor is given', () => {
		const s = read('place=denver');
		expect(s.floorM).toBe(3000);
	});
});
