/**
 * Destinations are scored by the sky you are FLYING TO, not the one you are
 * leaving.
 *
 * The catalogue spans UTC+9 to UTC-10, and timeOfDay is recomputed to the
 * destination's own civil time on arrival — so scoring against the departure
 * hour optimised for a sky the viewer would never see.
 */
import { describe, it, expect } from 'vitest';
import { pickNextLocation } from '$lib/director/scenarios';
import { LOCATIONS } from '$content/locations';

/** 04:30 UTC — 10:00 in Hyderabad, ~22:30 in Dallas/Chicago. */
const OFFICE_MORNING_IST = new Date(Date.UTC(2026, 7, 15, 4, 30));

const zoneOf = (id: string) => LOCATIONS.find((l) => l.id === id)?.utcOffset ?? 0;

describe('pickNextLocation scores arrival-local sky', () => {
	it('favours daylit destinations during Hyderabad office hours', () => {
		// The office-hours darkness complaint, pinned. Five of the eight lit
		// cities are American, so at 10:00 IST most of the pool is in deep
		// night. Scoring by arrival time lets the pool follow the sun instead of
		// sending the wall to a dark Chicago mid-morning.
		const picks: string[] = [];
		for (let i = 0; i < 600; i++) {
			picks.push(pickNextLocation('hyderabad', 10, { now: OFFICE_MORNING_IST }));
		}
		// Eastern-hemisphere destinations (positive UTC offset) are in daylight
		// at this instant; the Americas are not.
		const eastern = picks.filter((id) => zoneOf(id) > 0).length;
		expect(eastern / picks.length).toBeGreaterThan(0.5);
	});

	it('is deterministic in its inputs — same clock, same candidate weighting', () => {
		// The roll itself is random, but the SCORING must not depend on hidden
		// state. Over many draws the distribution has to be stable for the same
		// instant, or the three panes would weight the pool differently.
		const sample = (n: number) => {
			const counts = new Map<string, number>();
			for (let i = 0; i < n; i++) {
				const id = pickNextLocation('hyderabad', 10, { now: OFFICE_MORNING_IST });
				counts.set(id, (counts.get(id) ?? 0) + 1);
			}
			return counts;
		};
		const a = sample(800);
		const b = sample(800);
		// Same locations appear in both samples — no candidate silently drops.
		expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
	});

	it('never returns the current location', () => {
		for (let i = 0; i < 200; i++) {
			expect(pickNextLocation('dubai', 10, { now: OFFICE_MORNING_IST })).not.toBe('dubai');
		}
	});
});
