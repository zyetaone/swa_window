/**
 * The climb profile — what moves the aircraft through the bands.
 *
 * Floor sits inside `ground` and the ceiling inside `stratosphere`, so a full
 * cycle visits every band rather than parking in one.
 */

export const ALTITUDE_FLOOR_M = 400;
export const ALTITUDE_CEILING_M = 13_000;
export const CLIMB_PERIOD_SEC = 900;

export class CameraPose {
	constructor(
		readonly lat: number,
		readonly lon: number,
		readonly altitudeM: number,
		readonly headingDeg: number,
		readonly pitchDeg: number
	) {}
}

/**
 * The model → world boundary: six primary numbers, nothing derived.
 *
 * Atmosphere, imagery and night factor used to ride along here, all three
 * computed from `camera.altitudeM` and `timeOfDay`. Derived state on a boundary
 * can disagree with its own inputs, and on three machines that disagreement is a
 * torn window no single-machine test would catch. The world derives them now.
 */
export class FlightFrame {
	constructor(
		readonly camera: CameraPose,
		readonly timeOfDay: number,
		/** Height above local terrain. The bands are keyed on this, not on MSL. */
		readonly aglM: number
	) {}
}

// ── Config ─────────────────────────────────────────────────────────────────────
