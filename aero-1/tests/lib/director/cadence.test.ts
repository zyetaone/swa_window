/**
 * The hop window must outlast the choreography it interrupts.
 *
 * This is the test that should have existed from the start. The scenarios and
 * the director cadence were tuned in different files by different concerns, and
 * nothing connected them — so authored flight paths of 160-270 s sat behind a
 * hop that fired every 90-180 s, and not one of the 21 scenarios ever played to
 * completion. Nothing errored; the content was simply never seen.
 */
import { describe, it, expect } from 'vitest';
import { director } from '$lib/model/config-tree.svelte';
import { SCENARIOS } from '$content/scenarios';

/** Total authored seconds for one scenario at the reference flight speed. */
function scenarioSeconds(s: (typeof SCENARIOS)[number]): number {
	return s.waypoints.reduce((sum, w) => sum + (w.duration ?? 0), 0);
}

describe('director cadence vs authored scenarios', () => {
	const durations = SCENARIOS.map(scenarioSeconds).filter((d) => d > 0);
	const longest = Math.max(...durations);

	it('has authored scenarios to measure against', () => {
		// Guards the premise — an empty catalogue would pass everything below.
		expect(durations.length).toBeGreaterThan(0);
	});

	it('holds a location long enough for the LONGEST circuit to finish', () => {
		// The minimum hop is the binding constraint: if even that outlasts the
		// longest scenario, every circuit can complete regardless of the roll.
		expect(director.autopilot.directorMinInterval).toBeGreaterThan(longest);
	});

	it('keeps the ambient re-roll slower than a location hop', () => {
		// Ambient jitter must be the quieter of the two rhythms. When it fires
		// faster than the hop it becomes the dominant churn and undoes the calm
		// the hop interval is there to create.
		expect(director.autopilot.subsequentMinDelay).toBeGreaterThan(60);
		expect(director.autopilot.subsequentMinDelay * 2).toBeLessThan(
			director.autopilot.directorMinInterval,
		);
	});

	it('leaves the vantage flyover beat reachable', () => {
		// The beat needs continuous night flying to accumulate. Its interval
		// should be within a small multiple of the hop interval, or it becomes
		// a feature that exists and never fires — which it was.
		const { vantage, directorMaxInterval } = director.autopilot;
		expect(vantage.minIntervalSec).toBeLessThan(directorMaxInterval * 3);
	});
});
