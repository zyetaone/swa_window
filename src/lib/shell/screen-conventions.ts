/**
 * screen-conventions.ts — the SINGLE parity that maps the flight's travel
 * direction to on-screen drift, and from which the wing's mirror + bank derive.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Travel direction (`flight.orbitDirection`) used to fan out to FOUR
 * independent sign sites — orbit drift, heading, wing mirror, wing lean — each
 * applying the sign separately in a different file. They only *coincidentally*
 * agreed at one operating point; when `orbitDirection` flipped, the drift
 * inverted through one parity chain and the wing through another, so the wing
 * flew "against the movement." On top of that the CameraMirror does a Y↔Z
 * handedness flip (so +X renders screen-LEFT — see Wing.svelte), making the
 * on-screen sign impossible to reason about from first principles. Every fix
 * was whack-a-mole because there was no single place the parity lived.
 *
 * ─── THE FIX ────────────────────────────────────────────────────────────────
 * ONE measured constant, SCREEN_DRIFT_SIGN, absorbs ALL the *fixed* parity (the
 * `+90` side-look in compose.ts, the CameraMirror handedness, the Three bank
 * axis). `screenTravelSign(travelSign) = travelSign * SCREEN_DRIFT_SIGN` is the
 * SINGLE expression the wing mirror AND the wing lean both derive from — the
 * same expression that defines which way the world drifts on screen. So
 * "wing sweeps WITH the movement" and "banks INTO the turn" become true BY
 * CONSTRUCTION, not coincidence: flip the travel direction and all three
 * (drift, mirror, lean) flip together because they're one term.
 *
 * ─── CALIBRATION ────────────────────────────────────────────────────────────
 * SCREEN_DRIFT_SIGN is measured ONCE, in the lab: flip it until the (unmirrored)
 * wing sweeps WITH the world — current pose → world drifts left-to-right. The
 * lab exposes `window.__wing.flipDriftSign()` for this. Once measured the value
 * is baked into `DEFAULT_SCREEN_DRIFT_SIGN` below and never touched again.
 *
 * ─── 3-Pi SAFETY ────────────────────────────────────────────────────────────
 * The baked default ships identically to all Pis and `setScreenDriftSign()` is
 * dev-only (lab calibration), so in production every Pi makes the identical
 * wing-pose decision — the deterministic-visual invariant holds.
 */

/** Baked after the one-time lab calibration. ±1. */
export const DEFAULT_SCREEN_DRIFT_SIGN = 1;

// Runtime value — equals the default in production; the lab toggle mutates it
// during calibration only.
let _screenDriftSign = DEFAULT_SCREEN_DRIFT_SIGN;

export function getScreenDriftSign(): number {
	return _screenDriftSign;
}

/** Dev-only: flip/set the parity live to calibrate, then bake the result. */
export function setScreenDriftSign(s: number): void {
	_screenDriftSign = s < 0 ? -1 : 1;
}

/**
 * The screen-space travel sign. `+` means the world drifts one way across the
 * window, `−` the other. The wing mirror and the wing's turn-lean both derive
 * from THIS, so they always match whichever way the world is actually drifting.
 */
export function screenTravelSign(travelSign: number): number {
	return (travelSign < 0 ? -1 : 1) * _screenDriftSign;
}
