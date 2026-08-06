/**
 * flight-readout — the ALT / GS / LOC triple shown to the passenger.
 *
 * WHAT IS SHARED IS THE FIELD SET, NOT THE MARKUP. The cinematic HUD overlay
 * and the side panel present these stats very differently (different chrome,
 * different classes, different layout), and they should — but they must agree
 * on *which* three stats a passenger sees and *how each one is formatted*.
 * Those two lists were written out twice, so adding a field or changing a
 * formatter silently updated one surface and not the other.
 *
 * Deliberately NOT a component: wrapping three spans in a shared component
 * would force both call sites onto one DOM shape and one stylesheet, which is
 * exactly the part that legitimately differs. A plain data function lets each
 * surface keep its own markup while sharing the definition.
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
 * The passenger-facing flight stats, in display order.
 *
 * Order is part of the contract: ALT then GS then LOC reads left-to-right the
 * same way on both surfaces, so a glance between them doesn't reshuffle.
 */
export function flightReadout(model: FlightReadoutSource): ReadoutStat[] {
	return [
		{ label: 'ALT', value: formatAltitudeFt(model.flight.altitude) },
		{ label: 'GS', value: formatSpeedX(model.flight.flightSpeed) },
		{ label: 'LOC', value: formatTime(model.localTimeOfDay) },
	];
}
