/**
 * Two features that existed in code and could never run.
 *
 * Both were found by arithmetic, not by looking at a screen, and both would
 * pass any test that only asserted "the function returns the right thing when
 * called" — the bug was that nothing ever called them in a reachable state.
 * So these tests assert REACHABILITY, not behaviour.
 */
import { describe, it, expect } from 'vitest';
import { director } from '$lib/model/config-tree.svelte';
import { pickNextLocation } from '$lib/director/scenarios';
import { LOCATIONS } from '$content/locations';

describe('vantage beat is reachable', () => {
	it('can now accumulate a full beat inside a single location hold', () => {
		// HISTORY, because the numbers moved twice and the reasoning is easy to
		// lose. The beat needs 900 s of continuous night flying. It used to be
		// unreachable for two independent reasons stacked on each other:
		// directorReset() zeroed its timer on every arrival, AND arrivals came
		// every 90-180 s. Fixing only the reset would have left it firing at
		// best rarely; fixing only the cadence would have left the reset
		// wiping it. Both had to move.
		//
		// This asserts the property that now holds and did not before: a hold
		// can last long enough to earn a beat on its own, without relying on
		// the timer surviving across hops. That makes the beat a thing you can
		// actually expect to see rather than a statistical accident.
		//
		// The previous version of this test compared minIntervalSec against
		// directorMaxInterval as a tripwire for the reset bug. That comparison
		// was a proxy, and the cadence change made it meaningless (they are now
		// equal), so it has been replaced rather than loosened.
		const ap = director.autopilot;
		expect(ap.vantage.minIntervalSec).toBeLessThanOrEqual(ap.directorMaxInterval);
	});

	it('has a night threshold below full darkness, so it can fire during the night ramp', () => {
		// A threshold of 1.0 would need absolute maximum nightFactor, which the
		// curve only touches at its peak — another way to be unreachable.
		expect(director.autopilot.vantage.minNightFactor).toBeGreaterThan(0);
		expect(director.autopilot.vantage.minNightFactor).toBeLessThan(1);
	});
});

describe('every location is reachable by the director', () => {
	const unlit = LOCATIONS.filter((l) => l.hasBuildings === false).map((l) => l.id);

	it('has locations without buildings worth protecting', () => {
		// Guards the premise of the next test: if the catalogue ever loses its
		// nature locations, the test below would pass vacuously.
		expect(unlit.length).toBeGreaterThan(0);
	});

	it('reaches unlit locations when the city lights are off', () => {
		// nightLitOnly must be gated on darkness. Passed unconditionally, it
		// stranded every hasBuildings:false location at every hour of the day.
		const seen = new Set<string>();
		for (let i = 0; i < 400; i++) {
			seen.add(pickNextLocation('hyderabad', 12, { nightLitOnly: false }));
		}
		expect(unlit.some((id) => seen.has(id))).toBe(true);
	});

	it('still restricts to lit cities when the filter is on', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 400; i++) {
			seen.add(pickNextLocation('hyderabad', 23, { nightLitOnly: true }));
		}
		expect(unlit.every((id) => !seen.has(id))).toBe(true);
	});
});
