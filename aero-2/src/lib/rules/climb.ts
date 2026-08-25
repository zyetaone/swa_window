/**
 * How high the aircraft is. Pure function of wall-clock time.
 */
import {
	ALTITUDE_CEILING_M,
	ALTITUDE_FLOOR_M,
	CLIMB_PERIOD_SEC,
} from '#lib/assets/data/climb.js';

/**
 * Altitude at an instant — one slow climb-and-descend, absolute in wall-clock
 * time so every Pi is at the same height at the same moment.
 */
export function altitudeAt(wallT: number): number {
	if (!Number.isFinite(wallT)) return ALTITUDE_FLOOR_M;
	const phase = (wallT / CLIMB_PERIOD_SEC) * Math.PI * 2;
	const t = (Math.sin(phase) + 1) * 0.5;
	return ALTITUDE_FLOOR_M + (ALTITUDE_CEILING_M - ALTITUDE_FLOOR_M) * t;
}
