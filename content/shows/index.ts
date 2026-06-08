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
 * `sunset-dubai.show.ts` (a timed-cue sequence, not a boot baseline) is
 * NOT in the rotation — it's an authored demo show triggered explicitly,
 * not a baseline. Including it would have cues firing on every boot.
 */

import type { Show } from '$lib/show/load';
import { createSeededRng, daySeed } from '$lib/world-three/prng';

import { defaultShow } from './default.show';
import { duskDubaiShow } from './dusk-dubai.show';
import { nightVegasShow } from './night-vegas.show';
import { monsoonMumbaiShow } from './monsoon-mumbai.show';
import { dawnHimalayasShow } from './dawn-himalayas.show';
import { pacificEveningShow } from './pacific-evening.show';
import { nightCloudsShow } from './night-clouds.show';

/** The daily rotation set — distinct location / weather / time mix. */
export const DAILY_ROTATION: readonly Show[] = [
	defaultShow,           // Hyderabad dawn clear — SWA install brand baseline
	duskDubaiShow,         // Dubai golden hour clear
	nightVegasShow,        // Las Vegas night clear
	monsoonMumbaiShow,     // Mumbai monsoon rain
	dawnHimalayasShow,     // Himalayas alpine dawn
	pacificEveningShow,    // Pacific Ocean sunset
	nightCloudsShow,       // Above clouds deep night
];

export { defaultShow };

/**
 * Pick the show for today. Deterministic across all Pis on the same day,
 * different each day. Caller should pass this to `applyShowOpening` at
 * boot before persisted state is restored.
 */
export function pickDailyShow(): Show {
	const rng = createSeededRng(daySeed());
	const idx = Math.floor(rng() * DAILY_ROTATION.length);
	return DAILY_ROTATION[idx];
}
