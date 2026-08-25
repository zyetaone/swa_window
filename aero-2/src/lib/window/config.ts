/**
 * Tuning knobs read imperatively each tick.
 *
 * Deliberately NOT runes: nothing subscribes to these, so `$state` would only
 * add proxy overhead on a hot path for reactivity no one consumes. Deliberately
 * flat consts, not a class tree: the class shape (CameraConfig/DirectorConfig/
 * ConfigTree) was built for an engine tuning object nothing ever read
 * back — the window reads these once per frame and nothing else touches them.
 */

/**
 * Where the window looks, relative to where the aircraft is going.
 *
 * 0 would be the windscreen. A passenger window is roughly perpendicular, so
 * the default is -90 — out of the left side. This is also the ONLY value that
 * differs between the three panes of the wall: one aircraft, one clock, one
 * atmosphere, three azimuths whose frusta tile into a single window.
 */
export const DEFAULT_WINDOW_AZIMUTH_DEG = -90;

export const DEFAULT_PITCH_DEG = -18;

/** ~6 min per orbit. See orbitRate() in flight/rules.ts: rate = driftRate * flightSpeed / meanRadius. */
export const ORBIT = {
	driftRate: 3.42e-4,
	majorMin: 0.08,
	majorMax: 0.25,
	breathePeriod: 180,
	flightSpeed: 6.0
} as const;
