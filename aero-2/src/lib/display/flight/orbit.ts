/**
 * Aircraft orbit kinematics, ground track, heading, and altitude climb curves.
 * Pure deterministic mathematics — rune-free and renderer-free.
 */

export const ORBIT = {
	driftRate: 3.42e-4,
	majorMin: 0.08,
	majorMax: 0.25,
	breathePeriod: 180,
	flightSpeed: 6.0
} as const;

export const ALTITUDE_FLOOR_M = 400;
export const ALTITUDE_CEILING_M = 13_000;
export const CLIMB_PERIOD_SEC = 900;

const TWO_PI = Math.PI * 2;
const M_PER_DEG_LAT = 111_320;

export function normalizeHeading(deg: number): number {
	return ((deg % 360) + 360) % 360;
}

export interface OrbitPose {
	lat: number;
	lon: number;
	headingDeg: number;
	aglM: number;
}

export function orbitPose(
	wallSec: number,
	centerLat: number,
	centerLon: number,
	floorM: number = ALTITUDE_FLOOR_M,
	ceilingM: number = ALTITUDE_CEILING_M
): OrbitPose {
	const breathePhase = (wallSec % ORBIT.breathePeriod) / ORBIT.breathePeriod;
	const breathe = (1 - Math.cos(breathePhase * TWO_PI)) * 0.5;
	const a = ORBIT.majorMin + (ORBIT.majorMax - ORBIT.majorMin) * breathe;
	const b = a * 0.6;

	const theta = (wallSec * ORBIT.driftRate * TWO_PI) % TWO_PI;
	const cosLat = Math.cos((centerLat * Math.PI) / 180);

	const dLat = a * Math.sin(theta);
	const dLon = (b * Math.cos(theta)) / (cosLat || 1);

	const vx = ((b * -Math.sin(theta)) / (cosLat || 1)) * 111_320;
	const vy = a * Math.cos(theta) * M_PER_DEG_LAT;
	const headingDeg = normalizeHeading(90 - (Math.atan2(vy, vx) * 180) / Math.PI);

	const aglM = altitudeAt(wallSec, floorM, ceilingM);

	return {
		lat: centerLat + dLat,
		lon: centerLon + dLon,
		headingDeg,
		aglM
	};
}

export function altitudeAt(
	wallSec: number,
	floorM: number = ALTITUDE_FLOOR_M,
	ceilingM: number = ALTITUDE_CEILING_M
): number {
	const phase = (wallSec % CLIMB_PERIOD_SEC) / CLIMB_PERIOD_SEC;
	const smooth = (1 - Math.cos(phase * TWO_PI)) * 0.5;
	return floorM + (ceilingM - floorM) * smooth;
}
