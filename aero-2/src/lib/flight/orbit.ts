import { normalizeHeading } from '#lib/utils.js';

export function integrateOrbitAngle(opts: {
	angle0: number;
	wallT0: number;
	wallT: number;
	a: number;
	b: number;
	direction: number;
	driftRate: number;
	flightSpeed: number;
	stepSec?: number;
}): number {
	const { angle0, wallT0, wallT, a, b, direction, driftRate, flightSpeed } = opts;
	const stepSec = opts.stepSec ?? 0.05;
	if (!(wallT > wallT0) || !Number.isFinite(wallT) || !Number.isFinite(wallT0)) {
		return wrapAngle(angle0);
	}
	let angle = angle0;
	let t = wallT0;
	const end = Math.min(wallT, wallT0 + 60);
	while (t < end - 1e-9) {
		const dt = Math.min(stepSec, end - t);
		const tx = a * Math.cos(angle);
		const ty = -b * Math.sin(angle);
		const localSpeed = Math.sqrt(tx * tx + ty * ty);
		angle += direction * ((driftRate * flightSpeed) / Math.max(localSpeed, 0.001)) * dt;
		t += dt;
	}
	if (wallT > end) {
		const dt = wallT - end;
		const tx = a * Math.cos(angle);
		const ty = -b * Math.sin(angle);
		const localSpeed = Math.sqrt(tx * tx + ty * ty);
		angle += direction * ((driftRate * flightSpeed) / Math.max(localSpeed, 0.001)) * dt;
	}
	return wrapAngle(angle);
}

function wrapAngle(a: number): number {
	const twoPi = Math.PI * 2;
	let x = a % twoPi;
	if (x < 0) x += twoPi;
	return x;
}

/** Elliptical orbit around a fixed centre — wall-clock derived for fleet safety. */
export function orbitPose(opts: {
	wallT: number;
	centerLat: number;
	centerLon: number;
	orbitAngle0: number;
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

	const orbitAngle = integrateOrbitAngle({
		angle0: opts.orbitAngle0,
		wallT0: opts.orbitEpochWallT,
		wallT: opts.wallT,
		a: major,
		b: minor,
		direction: opts.direction,
		driftRate: opts.driftRate,
		flightSpeed: opts.flightSpeed,
	});

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
