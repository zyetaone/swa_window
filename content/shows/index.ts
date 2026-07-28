/**
 * Shows registry — daily-seeded rotation across boot-baseline opens.
 *
 * Each Pi kiosk boot calls `pickDailyShow()` which uses `daySeed()` to
 * pick deterministically across the rotation set. All 3 Pis in a panorama
 * group pick the SAME show on a given day (daySeed is shared), and the
 * picked show CHANGES every day at midnight UTC.
 *
 * Why per-day (not per-boot):
 *   - 3-Pi panorama: all Pis must see the same opening or the seam breaks.
 *   - Office-worker expectation: same day = same scene (don't surprise the
 *     6 PM passer-by with a different opening from the 9 AM passer-by),
 *     next day = something new (avoids "every visit looks the same").
 *
 * Roll-over at midnight UTC ≈ 5:30 AM Hyderabad — kiosk is unattended.
 *
 * `default.show.ts` is included in the rotation AND remains the named
 * fallback for any code path that wants a guaranteed-stable opening.
 *
 */

import type { Show } from './types';
export type { Show };
import { createSeededRng, daySeed, hashString } from '$lib/world/prng';

import { defaultShow } from './default.show';
import { duskDubaiShow } from './dusk-dubai.show';
import { nightVegasShow } from './night-vegas.show';
import { monsoonMumbaiShow } from './monsoon-mumbai.show';
import { dawnHimalayasShow } from './dawn-himalayas.show';
import { pacificEveningShow } from './pacific-evening.show';
import { middayPhoenixShow } from './midday-phoenix.show';

/** The daily rotation set — distinct location / weather / time mix. */
export const DAILY_ROTATION: readonly Show[] = [
	defaultShow,           // Hyderabad dawn clear — SWA install brand baseline
	duskDubaiShow,         // Dubai golden hour clear
	nightVegasShow,        // Las Vegas night clear
	monsoonMumbaiShow,     // Mumbai monsoon rain
	dawnHimalayasShow,     // Himalayas alpine dawn
	pacificEveningShow,    // Pacific Ocean sunset
	middayPhoenixShow,     // Phoenix clear noon — the daytime hero
	// nightCloudsShow is OUT of rotation (Jul-13 plan): at 23:00 over a
	// hasBuildings:false cloud deck there is no VIIRS, no city layer and no
	// cloud floor — a 1-in-N boot rendered as a black void, contradicting
	// the director's own nightLitCitiesOnly doctrine. It returns once a
	// moonlit-cloud-floor layer ships (post-P8 ticket; the layer lives on
	// the Three overlay, which is default-off until the perf gate).
];

export { defaultShow };

/**
 * Pick the show for today. Deterministic across all Pis on the same day,
 * different each day. Caller should pass this to `applyShowOpening` at
 * boot before persisted state is restored.
 *
 * CONTENT-ADDRESSED (rendezvous hashing), not positional: each show gets a
 * per-day score from seed^hash(show.id); the max score wins. The old
 * `floor(rng() * length)` index meant ANY rotation edit remapped EVERY
 * day's pick — and worse, a mixed-version fleet (rolling OTA mid-panorama)
 * computed different indices from the same seed, splitting left/center/
 * right across different shows. With rendezvous hashing, adding or
 * removing a show only reassigns the days that show itself wins; all
 * other days keep their pick, and Pis agree as long as their rotation
 * SETS match. Rotation edits still deploy fleet-atomically (a version
 * skew of the set itself can still diverge), but the blast radius of an
 * edit is now that one show's days, not the whole calendar.
 *
 * `seed` is injectable for tests; defaults to today's daySeed().
 */
export function pickDailyShow(seed: number = daySeed()): Show {
	let best = DAILY_ROTATION[0];
	let bestScore = -1;
	for (const show of DAILY_ROTATION) {
		const score = createSeededRng((seed ^ hashString(show.id)) >>> 0)();
		if (score > bestScore) {
			bestScore = score;
			best = show;
		}
	}
	return best;
}
