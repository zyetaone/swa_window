import { describe, it, expect } from 'vitest';
import {
	glowFactor,
	viirsRoadGlowScale,
	viirsGlowBucketIndex,
	viirsGlowBucketCenter,
	VIIRS_ROAD_GLOW_FLOOR,
} from '$lib/world/viirs-glow';

describe('glowFactor', () => {
	it('floors dark VIIRS cells', () => {
		expect(glowFactor(0, VIIRS_ROAD_GLOW_FLOOR)).toBeCloseTo(VIIRS_ROAD_GLOW_FLOOR);
	});

	it('reaches unity on bright cores', () => {
		expect(glowFactor(255, VIIRS_ROAD_GLOW_FLOOR)).toBeCloseTo(1);
	});
});

describe('viirsRoadGlowScale', () => {
	it('maps 0..1 field samples to [floor, 1]', () => {
		expect(viirsRoadGlowScale(0)).toBeCloseTo(VIIRS_ROAD_GLOW_FLOOR);
		expect(viirsRoadGlowScale(1)).toBeCloseTo(1);
	});
});

describe('viirsGlowBucketIndex', () => {
	it('quantizes without collapsing floor and ceiling', () => {
		expect(viirsGlowBucketIndex(VIIRS_ROAD_GLOW_FLOOR)).toBe(0);
		expect(viirsGlowBucketIndex(1)).toBeGreaterThan(0);
	});
});

describe('viirsGlowBucketCenter', () => {
	it('returns stable centres inside [floor, 1]', () => {
		const c = viirsGlowBucketCenter(3);
		expect(c).toBeGreaterThan(VIIRS_ROAD_GLOW_FLOOR);
		expect(c).toBeLessThanOrEqual(1);
	});
});
