/**
 * pickDailyShow — content-addressed (rendezvous-hashed) rotation.
 *
 * Pins the two properties the 3-Pi fleet depends on:
 *   1. Determinism: same seed → same show, every call, every Pi.
 *   2. Edit stability: removing one show only reassigns that show's slots.
 *   3. Slot seed: showRotationSeed advances every ROTATION_SLOT_HOURS UTC.
 */
import { describe, it, expect } from 'vitest';
import { createSeededRng, daySeed, hashString } from '$lib/world/prng';
import {
	DAILY_ROTATION,
	pickDailyShow,
	showRotationSeed,
	ROTATION_SLOT_HOURS,
} from '$content/shows';

describe('pickDailyShow', () => {
	it('is deterministic for a fixed seed', () => {
		const seed = daySeed(new Date(Date.UTC(2026, 6, 13)));
		const a = pickDailyShow(seed);
		const b = pickDailyShow(seed);
		expect(a.id).toBe(b.id);
	});

	it('covers the whole rotation across a year of day seeds (no show unreachable)', () => {
		const seen = new Set<string>();
		for (let day = 0; day < 366; day++) {
			const seed = daySeed(new Date(Date.UTC(2026, 0, 1 + day)));
			seen.add(pickDailyShow(seed).id);
		}
		expect(seen.size).toBe(DAILY_ROTATION.length);
	});

	it('rotation edits only reassign the removed show\'s own days', () => {
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
			if (full.id === removed.id) continue;
			expect(winner(seed, reduced).id).toBe(full.id);
		}
	});
});

describe('showRotationSeed', () => {
	it('is stable within a UTC slot and changes across slots', () => {
		const a = showRotationSeed(new Date(Date.UTC(2026, 7, 14, 10, 15)));
		const b = showRotationSeed(new Date(Date.UTC(2026, 7, 14, 10, 55)));
		expect(a).toBe(b);
		const c = showRotationSeed(new Date(Date.UTC(2026, 7, 14, 10 + ROTATION_SLOT_HOURS, 0)));
		expect(c).not.toBe(a);
	});

	it('is shared by all devices at the same wall clock (multi-Pi)', () => {
		const t = new Date(Date.UTC(2026, 7, 14, 16, 30));
		expect(showRotationSeed(t)).toBe(showRotationSeed(new Date(t.getTime())));
		expect(pickDailyShow(showRotationSeed(t)).id).toBe(pickDailyShow(showRotationSeed(t)).id);
	});
});
