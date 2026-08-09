/**
 * flight-readout — the shared ALT / GS / LOCAL field set (operator surfaces).
 *
 * Passenger glass no longer renders this triple; SidePanel does. These tests
 * pin the data contract so operator chrome cannot drift on labels/formatters.
 */
import { describe, it, expect } from 'vitest';
import { flightReadout } from '$lib/shell/hud/flight-readout';
import { formatAltitudeFt, formatSpeedX, formatTime } from '$lib/utils';

const model = { flight: { altitude: 35_000, flightSpeed: 1.25 }, localTimeOfDay: 14.5 };

describe('flightReadout', () => {
	it('returns ALT, GS and LOCAL in display order', () => {
		expect(flightReadout(model).map((s) => s.label)).toEqual(['ALT', 'GS', 'LOCAL']);
	});

	it('formats each stat with the shared formatter, not an ad-hoc one', () => {
		const [alt, gs, local] = flightReadout(model);
		expect(alt.value).toBe(formatAltitudeFt(35_000));
		expect(gs.value).toBe(formatSpeedX(1.25));
		expect(local.value).toBe(formatTime(14.5));
	});

	it('produces human-readable values', () => {
		const [alt, gs, local] = flightReadout(model);
		expect(alt.value).toBe('35.0k ft');
		expect(gs.value).toBe('1.3x');
		expect(local.value).toBe('2:30 PM');
	});

	it('labels are unique — they key the {#each} on operator surfaces', () => {
		const labels = flightReadout(model).map((s) => s.label);
		expect(new Set(labels).size).toBe(labels.length);
	});

	it('tracks the model rather than snapshotting it', () => {
		const climbing = { flight: { altitude: 41_000, flightSpeed: 2 }, localTimeOfDay: 3.25 };
		expect(flightReadout(climbing).map((s) => s.value)).toEqual(['41.0k ft', '2.0x', '3:15 AM']);
	});
});
