/**
 * Flight dynamics, orbital trajectory, clock, atmosphere blending, and lighting curves.
 * Pure deterministic mathematics — rune-free and renderer-free.
 */
import {
	ATMOSPHERE_BANDS,
	TRANSITION_HALF_WIDTH_M,
	ORBIT,
	ALTITUDE_FLOOR_M,
	ALTITUDE_CEILING_M,
	CLIMB_PERIOD_SEC,
	type AtmosphereState,
	type PaneParams,
	type Rgb
} from '#lib/config.js';

const TWO_PI = Math.PI * 2;
const M_PER_DEG_LAT = 111_320;

// ── Orbit Trajectory ──────────────────────────────────────────────────────────

export function normalizeHeading(deg: number): number {
	return ((deg % 360) + 360) % 360;
}

export function orbitRadiusAt(
	t: number,
	majorMin: number,
	majorMax: number,
	periodSec: number
): { a: number; b: number } {
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

// ── Altitude & Time ───────────────────────────────────────────────────────────

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

// ── Window View Representation ────────────────────────────────────────────────

export interface WindowView {
	readonly lat: number;
	readonly lon: number;
	readonly aglM: number;
	readonly mslM: number;
	readonly trackDeg: number;
	readonly headingDeg: number;
	readonly targetLat: number;
	readonly targetLon: number;
	readonly timeOfDay: number;
}

export function windowView(wallT: number, params: PaneParams, now?: Date): WindowView {
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

	const aglM = altitudeAt(wallT, params.floorM, params.ceilingM, CLIMB_PERIOD_SEC);
	const mslM = aglM + place.groundElevationM;
	const trackDeg = pose.headingDeg;
	const headingDeg = normalizeHeading(trackDeg + params.azimuthDeg);

	const pitchRad = (params.pitchDeg * Math.PI) / 180;
	const depressionRad = Math.max(-pitchRad, 0.05);
	const groundDistM = aglM / Math.tan(depressionRad);

	const headingRad = (headingDeg * Math.PI) / 180;
	const targetNorthM = groundDistM * Math.cos(headingRad);
	const targetEastM = groundDistM * Math.sin(headingRad);

	const targetLat = pose.lat + targetNorthM / M_PER_DEG_LAT;
	const cosLat = Math.max(Math.cos((pose.lat * Math.PI) / 180), 0.01);
	const targetLon = pose.lon + targetEastM / (M_PER_DEG_LAT * cosLat);

	const timeOfDay = resolveLocalHours({
		timeZone: place.timeZone,
		utcOffset: place.utcOffset,
		now
	});

	return {
		lat: pose.lat,
		lon: pose.lon,
		aglM,
		mslM,
		trackDeg,
		headingDeg,
		targetLat,
		targetLon,
		timeOfDay
	};
}

// ── Atmosphere & Lighting ─────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
	return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function bandIndexAt(altitudeM: number): number {
	for (let i = 0; i < ATMOSPHERE_BANDS.length; i++) {
		if (altitudeM < ATMOSPHERE_BANDS[i].topM) return i;
	}
	return ATMOSPHERE_BANDS.length - 1;
}

function thickness(i: number): number {
	const floor = i === 0 ? 0 : ATMOSPHERE_BANDS[i - 1].topM;
	const top = ATMOSPHERE_BANDS[i].topM;
	return Number.isFinite(top) ? top - floor : Number.POSITIVE_INFINITY;
}

function halfWidthAbove(i: number): number {
	return Math.min(TRANSITION_HALF_WIDTH_M, thickness(i) * 0.45, thickness(i + 1) * 0.45);
}

export function resolveAtmosphere(altitudeM: number): AtmosphereState {
	const safeAlt = Number.isFinite(altitudeM) ? Math.max(0, altitudeM) : 0;
	const i = bandIndexAt(safeAlt);
	const band = ATMOSPHERE_BANDS[i];
	const top = band.topM;

	if (Number.isFinite(top)) {
		const hw = halfWidthAbove(i);
		const d = safeAlt - top;
		if (d >= -hw && d <= 0) {
			const t = (d + hw) / (2 * hw);
			const smooth = t * t * (3 - 2 * t);
			const next = ATMOSPHERE_BANDS[i + 1];
			return {
				bandId: band.id,
				nextBandId: next.id,
				crossing: (d + hw) / hw,
				fogDensity: lerp(band.fogDensity, next.fogDensity, smooth),
				groundDetail: lerp(band.groundDetail, next.groundDetail, smooth),
				deckOpacity: lerp(band.deckOpacity, next.deckOpacity, smooth),
				skyTop: lerpRgb(band.skyTop, next.skyTop, smooth),
				skyHorizon: lerpRgb(band.skyHorizon, next.skyHorizon, smooth)
			};
		}
	}

	if (i > 0) {
		const floor = ATMOSPHERE_BANDS[i - 1].topM;
		const hw = halfWidthAbove(i - 1);
		const d = safeAlt - floor;
		if (d >= 0 && d <= hw) {
			const t = (d + hw) / (2 * hw);
			const smooth = t * t * (3 - 2 * t);
			const prev = ATMOSPHERE_BANDS[i - 1];
			return {
				bandId: band.id,
				nextBandId: prev.id,
				crossing: 1 - d / hw,
				fogDensity: lerp(prev.fogDensity, band.fogDensity, smooth),
				groundDetail: lerp(prev.groundDetail, band.groundDetail, smooth),
				deckOpacity: lerp(prev.deckOpacity, band.deckOpacity, smooth),
				skyTop: lerpRgb(prev.skyTop, band.skyTop, smooth),
				skyHorizon: lerpRgb(prev.skyHorizon, band.skyHorizon, smooth)
			};
		}
	}

	return {
		bandId: band.id,
		nextBandId: null,
		crossing: 0,
		fogDensity: band.fogDensity,
		groundDetail: band.groundDetail,
		deckOpacity: band.deckOpacity,
		skyTop: band.skyTop,
		skyHorizon: band.skyHorizon
	};
}

export function nightFactor(hours24: number): number {
	const h = ((hours24 % 24) + 24) % 24;
	if (h >= 6 && h <= 18) return 0;
	if (h <= 5 || h >= 21) return 1;
	if (h > 18 && h < 21) {
		const t = (h - 18) / 3;
		return Math.sqrt(t);
	}
	const t = (6 - h) / 1;
	return t * t;
}
