/**
 * The model → world boundary. Leaf module: imports nothing.
 *
 * Keeping these here rather than beside AeroWindow is what breaks the cycle —
 * flight needs the DTOs, the window root needs flight.
 */

export class CameraPose {
	constructor(
		readonly lat: number,
		readonly lon: number,
		readonly altitudeM: number,
		readonly headingDeg: number,
		readonly pitchDeg: number,
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
export class GlobeSyncSlice {
	constructor(
		readonly camera: CameraPose,
		readonly timeOfDay: number,
	) {}
}

// ── Config ─────────────────────────────────────────────────────────────────────
