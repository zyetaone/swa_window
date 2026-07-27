import { describe, it, expect } from 'vitest';
import { earthOcclusionFactor } from '$lib/world/three/occlusion';
import { EARTH_RADIUS_M, OCCLUSION_FADE_RAD } from '$lib/world/three/state.svelte';

/**
 * The Three overlay composites above the Cesium canvas, so Cesium's terrain
 * never enters Three's depth buffer and no depthTest can hide a celestial
 * body behind the planet. earthOcclusionFactor is the ONLY Earth occluder —
 * which makes a sign or bias slip here invisible to types and to every other
 * test, while putting the moon on top of the ground.
 */
describe('earthOcclusionFactor', () => {
	// Camera 10 km up on the +X axis, so local "up" is +X and the zenith angle
	// of a direction is measured from it. Y spans the local horizontal.
	const camLen = EARTH_RADIUS_M + 10_000;

	/** Unit direction at zenith angle `z` (0 = overhead, pi = straight down). */
	const dirAtZenith = (z: number) => [Math.cos(z), Math.sin(z), 0] as const;

	/** Zenith angle of the horizon — just past 90 deg by the horizon dip. */
	const zenithHorizon = Math.acos(
		-Math.sqrt(1 - (EARTH_RADIUS_M / camLen) ** 2),
	);

	const factorAtElevation = (elevationAboveHorizon: number) => {
		const [dx, dy, dz] = dirAtZenith(zenithHorizon - elevationAboveHorizon);
		return earthOcclusionFactor(camLen, 0, 0, dx, dy, dz);
	};

	it('leaves a body directly overhead fully visible', () => {
		expect(earthOcclusionFactor(camLen, 0, 0, 1, 0, 0)).toBe(1);
	});

	it('fully hides a body on the far side of the planet', () => {
		expect(earthOcclusionFactor(camLen, 0, 0, -1, 0, 0)).toBe(0);
	});

	it('is fully hidden AT the horizon, not half-visible', () => {
		// The regression this pins: the old form returned 0.5 for the tangent
		// ray, so the moon sat on — and bled through — the horizon line.
		expect(factorAtElevation(0)).toBeCloseTo(0, 6);
	});

	it('stays hidden below the horizon', () => {
		expect(factorAtElevation(-0.001)).toBe(0);
		expect(factorAtElevation(-0.05)).toBe(0);
	});

	it('reaches full brightness one fade-band above the horizon', () => {
		expect(factorAtElevation(OCCLUSION_FADE_RAD)).toBeCloseTo(1, 6);
		expect(factorAtElevation(OCCLUSION_FADE_RAD * 2)).toBe(1);
	});

	it('ramps monotonically across the band rather than popping', () => {
		const half = factorAtElevation(OCCLUSION_FADE_RAD / 2);
		expect(half).toBeGreaterThan(0.4);
		expect(half).toBeLessThan(0.6);
		let prev = -1;
		for (let i = 0; i <= 10; i++) {
			const f = factorAtElevation((i / 10) * OCCLUSION_FADE_RAD);
			expect(f).toBeGreaterThanOrEqual(prev);
			prev = f;
		}
	});

	it('never returns a value outside 0..1 over a full sweep', () => {
		for (let i = 0; i <= 64; i++) {
			const [dx, dy, dz] = dirAtZenith((i / 64) * Math.PI);
			const f = earthOcclusionFactor(camLen, 0, 0, dx, dy, dz);
			expect(f).toBeGreaterThanOrEqual(0);
			expect(f).toBeLessThanOrEqual(1);
		}
	});
});
