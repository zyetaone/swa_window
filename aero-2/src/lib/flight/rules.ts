/**
 * Where and how high the aircraft is. Both pure functions of wall-clock time.
 */
import {
	ALTITUDE_CEILING_M,
	ALTITUDE_FLOOR_M,
	CLIMB_PERIOD_SEC,
} from '#lib/flight/model.js';

function normalizeHeading(deg: number): number {
	return ((deg % 360) + 360) % 360;
}

/** Mean semi-axis over the breathe cycle — `minor` sweeps 0.35..0.50 of `major`. */
const MEAN_MINOR_RATIO = 0.425;

/**
 * Constant angular rate, sized so a bigger orbit is flown proportionally
 * slower — i.e. roughly constant ground speed across the breathe cycle.
 */
function orbitRate(opts: {
	majorMin: number;
	majorMax: number;
	driftRate: number;
	flightSpeed: number;
}): number {
	const meanMajor = (opts.majorMin + opts.majorMax) / 2;
	const meanRadius = (meanMajor * (1 + MEAN_MINOR_RATIO)) / 2;
	return (opts.driftRate * opts.flightSpeed) / Math.max(meanRadius, 1e-6);
}

function wrapAngle(a: number): number {
	const twoPi = Math.PI * 2;
	let x = a % twoPi;
	if (x < 0) x += twoPi;
	return x;
}

export function orbitPose(opts: {
	wallT: number;
	centerLat: number;
	centerLon: number;
	orbitAngle0: number;
	/** @deprecated Unread — the pose is absolute in wall-clock time. Drop at the call sites. */
	orbitEpochWallT: number;
	orbitBearingRad: number;
	direction: number;
	majorMin: number;
	majorMax: number;
	breathePeriod: number;
	driftRate: number;
	flightSpeed: number;
}): { lat: number; lon: number; headingDeg: number; orbitAngle: number } {
	const breathePhase = (opts.wallT / opts.breathePeriod) * Math.PI * 2;
	const breathe = (Math.sin(breathePhase) + 1) * 0.5;
	const major = opts.majorMin + breathe * (opts.majorMax - opts.majorMin);
	const minor = major * (0.35 + breathe * 0.15);

	// Pure function of wall-clock time: every Pi computes the same angle for the
	// same instant. The previous form integrated from each process's OWN first
	// tick, so three machines booted seconds apart flew three different orbits
	// forever — invisible on one screen, a torn window on three.
	const rate = orbitRate(opts);
	const orbitAngle = wrapAngle(opts.orbitAngle0 + opts.direction * rate * opts.wallT);

	const tx = major * Math.cos(orbitAngle);
	const ty = -minor * Math.sin(orbitAngle);
	const ex = major * Math.sin(orbitAngle);
	const ey = minor * Math.cos(orbitAngle);
	const cb = Math.cos(opts.orbitBearingRad);
	const sb = Math.sin(opts.orbitBearingRad);
	const cosLat = Math.cos((opts.centerLat * Math.PI) / 180);

	const lat = opts.centerLat + (ex * cb - ey * sb);
	const lon = opts.centerLon + (ex * sb + ey * cb) / Math.max(cosLat, 0.1);

	const vtx = tx * opts.direction;
	const vty = ty * opts.direction;
	const baseHeading =
		(Math.atan2(vtx * sb + vty * cb, vtx * cb - vty * sb) * 180) / Math.PI;
	const wander =
		Math.sin(opts.wallT * 0.05) * 0.25
		+ Math.sin(opts.wallT * 0.031) * 0.15
		+ Math.sin(opts.wallT * 0.017) * 0.1;

	return {
		lat,
		lon,
		headingDeg: normalizeHeading(baseHeading + wander),
		orbitAngle,
	};
}

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
