/**
 * Flight simulation — orbit trajectory, altitude curves, look targets, clock, and reactive FlightSim.
 */
import { untrack } from 'svelte';
import {
	ORBIT,
	ALTITUDE_FLOOR_M,
	ALTITUDE_CEILING_M,
	CLIMB_PERIOD_SEC
} from '#lib/config/window.js';
import type { WindowParams } from './params.js';

const TWO_PI = Math.PI * 2;
const M_PER_DEG_LAT = 111_320;

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

export function lookTarget(
	cameraLat: number,
	cameraLon: number,
	cameraAglM: number,
	headingDeg: number,
	pitchDeg: number
): { lat: number; lon: number } {
	const depressionRad = (-pitchDeg * Math.PI) / 180;
	const clampedDepression = Math.max(depressionRad, 0.05);
	const groundDistM = cameraAglM / Math.tan(clampedDepression);

	const bearingRad = (headingDeg * Math.PI) / 180;
	const northM = groundDistM * Math.cos(bearingRad);
	const eastM = groundDistM * Math.sin(bearingRad);

	const northDeg = northM / M_PER_DEG_LAT;
	const lat = cameraLat + northDeg;
	const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
	const eastDeg = eastM / (M_PER_DEG_LAT * cosLat);
	const lon = cameraLon + eastDeg;

	return { lat, lon };
}

export function resolveLocalHours(opts: {
	timeZone: string;
	utcOffset?: number;
	now?: Date;
}): number {
	const date = opts.now ?? new Date();
	try {
		const formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: opts.timeZone,
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
			hour12: false
		});
		const parts = formatter.formatToParts(date);
		const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
		const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
		const second = Number(parts.find((p) => p.type === 'second')?.value ?? '0');
		return hour + minute / 60 + second / 3600;
	} catch {
		const offset = opts.utcOffset ?? 0;
		const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
		return (((utcHours + offset) % 24) + 24) % 24;
	}
}

export interface WindowView {
	/** Eye position. */
	readonly lat: number;
	readonly lon: number;
	/** Height above ground, metres. */
	readonly aglM: number;
	/** Height above sea level, metres. */
	readonly mslM: number;
	/** Where the aircraft is going. */
	readonly trackDeg: number;
	/** Where this pane looks: track + its azimuth offset. */
	readonly headingDeg: number;
	/** The ground point the camera aims at. */
	readonly targetLat: number;
	readonly targetLon: number;
	/** Local wall-clock hours at the place being flown over. */
	readonly timeOfDay: number;
}

export function windowView(wallT: number, params: WindowParams, now?: Date): WindowView {
	const { place } = params;

	const pose = orbitPose({
		wallT,
		centerLat: place.lat,
		centerLon: place.lon,
		orbitAngle0: 0.5,
		orbitBearingRad: 0,
		direction: 1,
		...ORBIT
	});

	const aglM = altitudeAt(wallT, params.floorM, params.ceilingM);
	const headingDeg = normalizeHeading(pose.headingDeg + params.azimuthDeg);
	const target = lookTarget(pose.lat, pose.lon, aglM, headingDeg, params.pitchDeg);

	return {
		lat: pose.lat,
		lon: pose.lon,
		aglM,
		mslM: place.groundElevationM + aglM,
		trackDeg: pose.headingDeg,
		headingDeg,
		targetLat: target.lat,
		targetLon: target.lon,
		timeOfDay: resolveLocalHours({ timeZone: place.timeZone, utcOffset: place.utcOffset, now })
	};
}

export class FlightSim {
	readonly #getParams: () => WindowParams;
	view = $state<WindowView>({} as WindowView);

	constructor(params: WindowParams | (() => WindowParams)) {
		this.#getParams = typeof params === 'function' ? params : () => params;
		this.view = untrack(() => windowView(Date.now() / 1000, this.params));
	}

	get params(): WindowParams {
		return this.#getParams();
	}

	tick(wallSec: number = Date.now() / 1000): WindowView {
		const next = windowView(wallSec, this.params);
		this.view = next;
		return next;
	}

	// No per-field getters. `view` is already one immutable struct, so
	// `flight.view.aglM` reads fine and seven forwarding getters were just seven
	// more things to keep in sync with WindowView. All were unused.
}
