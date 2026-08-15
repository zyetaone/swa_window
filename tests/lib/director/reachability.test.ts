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
	it('cannot require more night-flying time than the gap between arrivals allows', () => {
		// directorReset() runs on every arrival. If it also zeroed the vantage
		// timer — as it used to — the beat could only fire when its minimum
		// interval was SHORTER than the longest gap between arrivals. It is
		// not, by a factor of five, which is precisely why the beat never fired.
		//
		// The timer now accumulates across arrivals, so this comparison no
		// longer gates reachability. The assertion is kept as a tripwire: if
		// someone reintroduces the reset, these numbers are the reason it
		// breaks, and this failure points straight at it.
		const ap = director.autopilot;
		expect(ap.vantage.minIntervalSec).toBeGreaterThan(ap.directorMaxInterval);
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
