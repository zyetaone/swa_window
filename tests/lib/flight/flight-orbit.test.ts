/**
 * Flight orbit determinism — the per-location orbit (bearing, start angle,
 * rotation direction) must be IDENTICAL across two engine instances at the
 * same location on the same day. This is what keeps a 3-Pi panorama
 * position-locked: each Pi runs its own FlightSimEngine, and if the orbit
 * seed diverged the three cameras would sit at different positions and the
 * panorama wouldn't tile.
 *
 * Previously this used raw Math.random() — these tests pin the daySeed()-
 * seeded replacement so a regression back to Math.random() fails loudly.
 */
import { describe, it, expect } from 'vitest';
import { FlightSimEngine } from '$lib/flight/flight.svelte';
import { LOCATION_IDS } from '$content/locations';

const FIRST_LOCATION = [...LOCATION_IDS][0];
const SECOND_LOCATION = [...LOCATION_IDS][1];

describe('FlightSimEngine orbit determinism', () => {
	it('two engines at the same location get an identical orbit', () => {
		const a = new FlightSimEngine();
		const b = new FlightSimEngine();
		a.setLocationWithSky(FIRST_LOCATION, 'day');
		b.setLocationWithSky(FIRST_LOCATION, 'day');
		expect(a.orbitBearing).toBe(b.orbitBearing);
		expect(a.orbitAngle).toBe(b.orbitAngle);
		expect(a.orbitDirection).toBe(b.orbitDirection);
	});

	it('orbitDirection is always +1 or -1', () => {
		const e = new FlightSimEngine();
		e.setLocationWithSky(FIRST_LOCATION, 'day');
		expect([1, -1]).toContain(e.orbitDirection);
	});

	it('different locations can yield different orbits (seed varies by location)', () => {
		const a = new FlightSimEngine();
		const b = new FlightSimEngine();
		a.setLocationWithSky(FIRST_LOCATION, 'day');
		b.setLocationWithSky(SECOND_LOCATION, 'day');
		// At least one orbit parameter should differ — the location hash feeds
		// the seed, so two different locations don't share the same orbit.
		const differs =
			a.orbitBearing !== b.orbitBearing ||
			a.orbitAngle !== b.orbitAngle ||
			a.orbitDirection !== b.orbitDirection;
		expect(differs).toBe(true);
	});

	it('re-seeding the same location is stable (idempotent within a day)', () => {
		const e = new FlightSimEngine();
		e.setLocationWithSky(FIRST_LOCATION, 'day');
		const dir1 = e.orbitDirection;
		const bear1 = e.orbitBearing;
		e.setLocationWithSky(SECOND_LOCATION, 'day');
		e.setLocationWithSky(FIRST_LOCATION, 'day');
		expect(e.orbitDirection).toBe(dir1);
		expect(e.orbitBearing).toBe(bear1);
	});
});
