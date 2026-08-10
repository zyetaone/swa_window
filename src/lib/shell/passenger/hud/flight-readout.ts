/**
 * flight-readout — the ALT / GS / LOCAL triple shown to the operator.
 *
 * WHAT IS SHARED IS THE FIELD SET, NOT THE MARKUP. SidePanel (and any future
 * operator surface) presents these stats with its own chrome, but every surface
 * must agree on *which* three stats appear and *how each one is formatted*.
 *
 * Passenger glass no longer renders this set — TelemetryOverlay is a soft
 * destination whisper only. This module remains the SSOT for operator readouts.
 *
 * Deliberately NOT a component: a plain data function lets each surface keep
 * its own markup while sharing the definition.
 */
import { formatAltitudeFt, formatSpeedX, formatTime } from '$lib/utils';

export interface ReadoutStat {
	/** Short uppercase label, e.g. `ALT`. */
	label: string;
	/** Already-formatted display value, e.g. `35.0k ft`. */
	value: string;
}

/** The subset of the model a readout needs. Keeps this testable without a viewer. */
export interface FlightReadoutSource {
	flight: { altitude: number; flightSpeed: number };
	localTimeOfDay: number;
}

/**
 * Operator-facing flight stats, in display order.
 *
 * LOCAL is scene solar time-of-day (not wall clock, not lat/lon).
 * Renamed from LOC so it is not read as "location".
 */
export function flightReadout(model: FlightReadoutSource): ReadoutStat[] {
	return [
		{ label: 'ALT', value: formatAltitudeFt(model.flight.altitude) },
		{ label: 'GS', value: formatSpeedX(model.flight.flightSpeed) },
		{ label: 'LOCAL', value: formatTime(model.localTimeOfDay) },
	];
}
