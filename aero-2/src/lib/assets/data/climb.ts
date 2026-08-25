/**
 * The climb profile — what moves the aircraft through the bands.
 *
 * Floor sits inside `ground` and the ceiling inside `stratosphere`, so a full
 * cycle visits every band rather than parking in one.
 */

export const ALTITUDE_FLOOR_M = 400;
export const ALTITUDE_CEILING_M = 13_000;
export const CLIMB_PERIOD_SEC = 900;
