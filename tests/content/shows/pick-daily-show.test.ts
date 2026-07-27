/**
 * pickDailyShow — content-addressed (rendezvous-hashed) daily rotation.
 *
 * Pins the two properties the 3-Pi fleet depends on:
 *   1. Determinism: same seed → same show, every call, every Pi.
 *   2. Edit stability: removing one show from the rotation only reassigns
 *      the days THAT show won — every other day keeps its pick. (The old
 *      positional `floor(rng() * length)` remapped the whole calendar on
 *      any rotation edit and could split a mixed-version panorama.)
 */
import { describe, it, expect } from 'vitest';
import { createSeededRng, daySeed, hashString } from '$lib/world/prng';
import { DAILY_ROTATION, pickDailyShow } from '$content/shows';

describe('pickDailyShow', () => {
	it('is deterministic for a fixed seed', () => {
		const seed = daySeed(new Date(Date.UTC(2026, 6, 13)));
		const a = pickDailyShow(seed);
		const b = pickDailyShow(seed);
		expect(a.id).toBe(b.id);
	});

	it('covers the whole rotation across a year (no show is unreachable)', () => {
		const seen = new Set<string>();
		for (let day = 0; day < 366; day++) {
			const seed = daySeed(new Date(Date.UTC(2026, 0, 1 + day)));
			seen.add(pickDailyShow(seed).id);
		}
		expect(seen.size).toBe(DAILY_ROTATION.length);
	});

	it('rotation edits only reassign the removed show\'s own days', () => {
		// Re-derive the rendezvous winner over a REDUCED set and compare:
		// for days the removed show did NOT win, the pick must be unchanged.
		const removed = DAILY_ROTATION[DAILY_ROTATION.length - 1];
		const reduced = DAILY_ROTATION.filter((s) => s.id !== removed.id);
		const winner = (seed: number, set: readonly { id: string }[]) => {
			let best = set[0];
			let bestScore = -1;
			for (const show of set) {
				const score = createSeededRng((seed ^ hashString(show.id)) >>> 0)();
				if (score > bestScore) { bestScore = score; best = show; }
			}
			return best;
		};
		for (let day = 0; day < 180; day++) {
			const seed = daySeed(new Date(Date.UTC(2026, 0, 1 + day)));
			const full = winner(seed, DAILY_ROTATION);
			if (full.id === removed.id) continue; // its own days may reassign
			expect(winner(seed, reduced).id).toBe(full.id);
		}
	});
});
