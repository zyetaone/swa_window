/**
 * screen-conventions.ts — The single source of truth for mapping flight travel
 * direction to on-screen world drift, wing reflection, and turn banking roll.
 */

export const DEFAULT_SCREEN_DRIFT_SIGN = 1;
export const SEAT_LOOK_DEG = 90;

let _screenDriftSign = DEFAULT_SCREEN_DRIFT_SIGN;

export function getScreenDriftSign(): number {
	return _screenDriftSign;
}

/** Dev/runtime calibration hook */
export function setScreenDriftSign(s: number): void {
	_screenDriftSign = s < 0 ? -1 : 1;
}

/**
 * The relative screen-space travel sign (+1 or -1).
 * The wing mirror, horizontal translation, and banking roll all derive from THIS term.
 */
export function screenTravelSign(travelSign: number): number {
	return (travelSign < 0 ? -1 : 1) * _screenDriftSign;
}
