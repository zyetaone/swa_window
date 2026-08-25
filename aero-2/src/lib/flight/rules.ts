/**
 * Pure flight rules — orbit trajectory and altitude curve.
 */

export const ALTITUDE_FLOOR_M = 400;
export const ALTITUDE_CEILING_M = 13_000;
export const CLIMB_PERIOD_SEC = 900;

const TWO_PI = Math.PI * 2;

export function normalizeHeading(deg: number): number {
	return ((deg % 360) + 360) % 360;
}

export function orbitRadiusAt(
	t: number,
	majorMin: number,
	majorMax: number,
	periodSec: number
): {
	a: number;
	b: number;
} {
	const p = Math.max(1, periodSec);
	const phase = (TWO_PI * (t % p)) / p;
	const s = (Math.sin(phase) + 1) / 2;
	const a = majorMin + (majorMax - majorMin) * s;
	return { a, b: a * 0.4 };
}

export function orbitRate(a: number, b: number, driftRate: number, flightSpeed: number): number {
	const mean = Math.max((a + b) / 2, 1e-4);
	return (driftRate * flightSpeed) / mean;
}

export function orbitAngleAt(opts: {
	wallT: number;
	orbitAngle0: number;
	orbitBearingRad: number;
	direction: number;
	majorMin: number;
	majorMax: number;
	breathePeriod: number;
	driftRate: number;
	flightSpeed: number;
}): number {
	const { a, b } = orbitRadiusAt(opts.wallT, opts.majorMin, opts.majorMax, opts.breathePeriod);
	const rate = orbitRate(a, b, opts.driftRate, opts.flightSpeed);
	const dir = opts.direction >= 0 ? 1 : -1;
	return opts.orbitAngle0 + dir * rate * opts.wallT;
}

export interface OrbitPose {
	lat: number;
	lon: number;
	headingDeg: number;
	orbitAngle: number;
}

const M_PER_DEG_LAT = 111_320;

export function orbitPose(opts: {
	wallT: number;
	centerLat: number;
	centerLon: number;
	orbitAngle0: number;
	orbitBearingRad: number;
	direction: number;
	majorMin: number;
	majorMax: number;
	breathePeriod: number;
	driftRate: number;
	flightSpeed: number;
}): OrbitPose {
	const { a, b } = orbitRadiusAt(opts.wallT, opts.majorMin, opts.majorMax, opts.breathePeriod);
	const rawAngle = orbitAngleAt(opts);
	const angle = ((rawAngle % TWO_PI) + TWO_PI) % TWO_PI;

	const xLocal = a * Math.cos(angle);
	const yLocal = b * Math.sin(angle);

	const cosB = Math.cos(opts.orbitBearingRad);
	const sinB = Math.sin(opts.orbitBearingRad);
	const northDeg = (xLocal * cosB - yLocal * sinB) * (1000 / M_PER_DEG_LAT);
	const eastDeg = (xLocal * sinB + yLocal * cosB) * (1000 / M_PER_DEG_LAT);

	const lat = opts.centerLat + northDeg;
	const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
	const lon = opts.centerLon + eastDeg / cosLat;

	const dxLocal = -a * Math.sin(angle);
	const dyLocal = b * Math.cos(angle);
	const dNorth = dxLocal * cosB - dyLocal * sinB;
	const dEast = dxLocal * sinB + dyLocal * cosB;

	const dir = opts.direction >= 0 ? 1 : -1;
	const headingRad = Math.atan2(dir * dEast, dir * dNorth);
	const headingDeg = normalizeHeading((headingRad * 180) / Math.PI);

	return { lat, lon, headingDeg, orbitAngle: angle };
}

export function altitudeAt(
	wallT: number,
	floorM: number = ALTITUDE_FLOOR_M,
	ceilingM: number = ALTITUDE_CEILING_M,
	periodSec: number = CLIMB_PERIOD_SEC
): number {
	if (!Number.isFinite(wallT)) return floorM;
	const p = Math.max(1, periodSec);
	const phase = (TWO_PI * (wallT % p)) / p;
	const s = (Math.sin(phase) + 1) / 2;
	return floorM + (ceilingM - floorM) * s;
}
