/**
 * flight-readout — the shared ALT / GS / LOC field set.
 *
 * What matters is that the HUD overlay and the side panel cannot drift on which
 * stats a passenger sees or how each is formatted. The markup is deliberately
 * NOT shared, so these tests pin the data contract only.
 */
import { describe, it, expect } from 'vitest';
import { flightReadout } from '$lib/shell/hud/flight-readout';
import { formatAltitudeFt, formatSpeedX, formatTime } from '$lib/utils';

const model = { flight: { altitude: 35_000, flightSpeed: 1.25 }, localTimeOfDay: 14.5 };

describe('flightReadout', () => {
	it('returns ALT, GS and LOC in display order', () => {
		expect(flightReadout(model).map((s) => s.label)).toEqual(['ALT', 'GS', 'LOC']);
	});

	it('formats each stat with the shared formatter, not an ad-hoc one', () => {
		const [alt, gs, loc] = flightReadout(model);
		expect(alt.value).toBe(formatAltitudeFt(35_000));
		expect(gs.value).toBe(formatSpeedX(1.25));
		expect(loc.value).toBe(formatTime(14.5));
	});

	it('produces human-readable values', () => {
		const [alt, gs, loc] = flightReadout(model);
		expect(alt.value).toBe('35.0k ft');
		expect(gs.value).toBe('1.3x');
		expect(loc.value).toBe('2:30 PM');
	});

	it('labels are unique — they key the {#each} on both surfaces', () => {
		const labels = flightReadout(model).map((s) => s.label);
		expect(new Set(labels).size).toBe(labels.length);
	});

	it('tracks the model rather than snapshotting it', () => {
		const climbing = { flight: { altitude: 41_000, flightSpeed: 2 }, localTimeOfDay: 3.25 };
		expect(flightReadout(climbing).map((s) => s.value)).toEqual(['41.0k ft', '2.0x', '3:15 AM']);
	});
});
