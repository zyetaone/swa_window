/**
 * Lightning determinism — invariant #4 (3-Pi panorama continuity).
 *
 * Lightning is a FULL-SCREEN flash. If each Pi rolled its own strike
 * timings, the three panels would flash at different moments, which is
 * the most visible seam any effect can produce. The strike sequence must
 * therefore be a pure function of (daySeed, stormIndex).
 */
import { describe, it, expect } from 'vitest';
import { createSeededRng, daySeed, hashString } from '$lib/world/prng';
import { pickLightningComposition } from '$content/compositions/lightning';
import { randomBetween } from '$lib/utils';

const STORM_SALT = 0x5c07;
const seedFor = (index: number, day = daySeed()) => (day ^ (index * STORM_SALT)) >>> 0;

/** Mirrors the draw order in lightning-stage.tickLightning. */
function stormSequence(index: number, strikes = 5, day = daySeed()) {
	const rng = createSeededRng(seedFor(index, day));
	const c = pickLightningComposition(rng);
	const out: Array<Record<string, number | string>> = [];
	// beginStorm draws the first interval before any strike.
	randomBetween(c.intervalRange[0], c.intervalRange[1], rng);
	for (let i = 0; i < strikes; i++) {
		out.push({
			id: c.id,
			flash: randomBetween(c.intensityRange[0], c.intensityRange[1], rng),
			x: randomBetween(c.xRange[0], c.xRange[1], rng),
			y: randomBetween(c.yRange[0], c.yRange[1], rng),
			next: randomBetween(c.intervalRange[0], c.intervalRange[1], rng),
		});
	}
	return out;
}

describe('lightning determinism', () => {
	it('three Pis on the same day + storm produce an identical strike sequence', () => {
		const left = stormSequence(0);
		const centre = stormSequence(0);
		const right = stormSequence(0);
		expect(centre).toEqual(left);
		expect(right).toEqual(left);
	});

	it('successive storms in one session differ', () => {
		expect(stormSequence(1)).not.toEqual(stormSequence(0));
	});

	it('the same storm index on a different day differs', () => {
		const today = daySeed(new Date('2026-08-02T00:00:00Z'));
		const tomorrow = daySeed(new Date('2026-08-03T00:00:00Z'));
		expect(stormSequence(0, 5, tomorrow)).not.toEqual(stormSequence(0, 5, today));
	});

	it('pickLightningComposition is pure in its injected rng', () => {
		const a = pickLightningComposition(createSeededRng(seedFor(3)));
		const b = pickLightningComposition(createSeededRng(seedFor(3)));
		expect(a.id).toBe(b.id);
	});

	it('storm seeds stay distinct across a long session', () => {
		const seeds = new Set(Array.from({ length: 500 }, (_, i) => seedFor(i)));
		expect(seeds.size).toBe(500);
	});

	it('daySeed XOR salt does not collide with the location-seed scheme', () => {
		// flight.svelte.ts seeds orbits with daySeed ^ hashString(locationId).
		// A collision would lock a storm's character to a location's orbit.
		const stormSeeds = new Set(Array.from({ length: 64 }, (_, i) => seedFor(i)));
		const orbitSeed = (daySeed() ^ hashString('hyderabad')) >>> 0;
		expect(stormSeeds.has(orbitSeed)).toBe(false);
	});
});
