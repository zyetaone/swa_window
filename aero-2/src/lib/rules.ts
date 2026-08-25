/**
 * Pure flight rules — orbit, atmosphere, imagery, lighting. No runes, no Cesium.
 */
import {
	ALTITUDE_CEILING_M,
	ALTITUDE_FLOOR_M,
	ATMOSPHERE_BANDS,
	CLIMB_PERIOD_SEC,
	DAY_IMAGERY_IDS,
	IMAGERY_SOURCES,
	TRANSITION_HALF_WIDTH_M,
	type AtmosphereBand,
	type ImagerySource,
	type Rgb,
} from '#lib/assets/data.js';
import { exceedsDeadband, normalizeHeading } from '#lib/utils.js';

// ── Orbit ──────────────────────────────────────────────────────────────────────

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

// ── Atmosphere ───────────────────────────────────────────────────────────────

export interface AtmosphereState {
	readonly bandId: string;
	readonly nextBandId: string | null;
	readonly crossing: number;
	readonly fogDensity: number;
	readonly groundDetail: number;
	readonly deckOpacity: number;
	readonly skyTop: Rgb;
	readonly skyHorizon: Rgb;
}

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
	const thinner = Math.min(thickness(i), thickness(i + 1));
	return Math.min(TRANSITION_HALF_WIDTH_M, thinner * 0.4);
}

function stateFrom(
	band: AtmosphereBand,
	next: AtmosphereBand | null,
	t: number,
	crossing: number,
): AtmosphereState {
	if (!next || t === 0) {
		return {
			bandId: band.id,
			nextBandId: null,
			crossing: 0,
			fogDensity: band.fogDensity,
			groundDetail: band.groundDetail,
			deckOpacity: band.deckOpacity,
			skyTop: band.skyTop,
			skyHorizon: band.skyHorizon,
		};
	}
	return {
		bandId: band.id,
		nextBandId: next.id,
		crossing,
		fogDensity: lerp(band.fogDensity, next.fogDensity, t),
		groundDetail: lerp(band.groundDetail, next.groundDetail, t),
		deckOpacity: lerp(band.deckOpacity, next.deckOpacity, t),
		skyTop: lerpRgb(band.skyTop, next.skyTop, t),
		skyHorizon: lerpRgb(band.skyHorizon, next.skyHorizon, t),
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

export function resolveAtmosphere(altitudeM: number): AtmosphereState {
	const alt = Number.isFinite(altitudeM) ? Math.max(0, altitudeM) : 0;
	const i = bandIndexAt(alt);
	const band = ATMOSPHERE_BANDS[i];

	const upper = ATMOSPHERE_BANDS[i + 1];
	if (upper) {
		const half = halfWidthAbove(i);
		if (alt > band.topM - half) {
			const t = Math.min((alt - (band.topM - half)) / (2 * half), 0.5);
			return stateFrom(band, upper, t, t * 2);
		}
	}

	const lower = ATMOSPHERE_BANDS[i - 1];
	if (lower) {
		const half = halfWidthAbove(i - 1);
		if (alt < lower.topM + half) {
			const t = Math.min((alt - (lower.topM - half)) / (2 * half), 1);
			return stateFrom(lower, band, t, (1 - t) * 2);
		}
	}

	return stateFrom(band, null, 0, 0);
}

// ── Imagery ────────────────────────────────────────────────────────────────────

const NIGHT_SWAP_HYSTERESIS = 0.08;
const DETAIL_STEP_HYSTERESIS = 0.35;

export interface ImagerySelection {
	readonly sourceId: string;
	readonly urlTemplate: string;
	readonly maximumLevel: number;
}

export interface ImageryInput {
	readonly groundDetail: number;
	readonly nightFactor: number;
	readonly current: ImagerySelection | null;
}

function clamp01(n: number): number {
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function sourceById(id: string): ImagerySource | undefined {
	return IMAGERY_SOURCES.find((s) => s.id === id);
}

function nearestSource(nightFactor: number): ImagerySource {
	return IMAGERY_SOURCES.reduce((best, s) =>
		Math.abs(s.nightAnchor - nightFactor) < Math.abs(best.nightAnchor - nightFactor) ? s : best,
	);
}

function selectSource(nightFactor: number, current: ImagerySelection | null): ImagerySource {
	const target = nearestSource(nightFactor);
	if (!current) return target;

	const incumbent = sourceById(current.sourceId);
	if (!incumbent || incumbent.id === target.id) return target;

	const incumbentDistance = Math.abs(incumbent.nightAnchor - nightFactor);
	const targetDistance = Math.abs(target.nightAnchor - nightFactor);
	return incumbentDistance - targetDistance > NIGHT_SWAP_HYSTERESIS ? target : incumbent;
}

export function selectDetailLevel(
	source: ImagerySource,
	groundDetail: number,
	currentLevel: number | null,
): number {
	const [min, max] = source.zoomRange;
	const target = min + (max - min) * clamp01(groundDetail);

	if (currentLevel === null) return Math.round(target);

	const held = Math.min(max, Math.max(min, currentLevel));
	return exceedsDeadband(held, target, 1 + DETAIL_STEP_HYSTERESIS) ? Math.round(target) : held;
}

export function selectImagery(input: ImageryInput): ImagerySelection {
	const source = selectSource(clamp01(input.nightFactor), input.current);

	const heldLevel =
		input.current && input.current.sourceId === source.id ? input.current.maximumLevel : null;

	return {
		sourceId: source.id,
		urlTemplate: source.urlTemplate,
		maximumLevel: selectDetailLevel(source, input.groundDetail, heldLevel),
	};
}

export function gateImagerySelection(
	selection: ImagerySelection,
	layerAvailable: (id: string) => boolean,
): ImagerySelection {
	if (layerAvailable(selection.sourceId)) return selection;

	for (const id of DAY_IMAGERY_IDS) {
		if (!layerAvailable(id)) continue;
		const src = IMAGERY_SOURCES.find((s) => s.id === id);
		if (!src) continue;
		return {
			sourceId: src.id,
			urlTemplate: src.urlTemplate,
			maximumLevel: selection.maximumLevel,
		};
	}

	return selection;
}

// ── Lighting ───────────────────────────────────────────────────────────────────

const TIME_THRESHOLDS = {
	DAWN_START: 5,
	DAY_START: 7,
	DAY_END: 18,
	DEEP_NIGHT: 21,
} as const;

export class NightLighting {
	factor(timeOfDay: number): number {
		const T = TIME_THRESHOLDS;
		if (timeOfDay >= T.DAY_START && timeOfDay <= T.DAY_END) return 0;
		if (timeOfDay < T.DAWN_START || timeOfDay > T.DEEP_NIGHT) return 1;
		if (timeOfDay < T.DAY_START) {
			const tDawn = (timeOfDay - T.DAWN_START) / (T.DAY_START - T.DAWN_START);
			return Math.sqrt(1 - tDawn);
		}
		const tDusk = (timeOfDay - T.DAY_END) / (T.DEEP_NIGHT - T.DAY_END);
		return Math.sqrt(tDusk);
	}
}

export const nightLighting = new NightLighting();
