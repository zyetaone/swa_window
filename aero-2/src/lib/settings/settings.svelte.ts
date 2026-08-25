/**
 * Reactive PaneSettings class ($state) and URL query parser.
 * Single source of truth for all live simulation knobs.
 */

import { Location } from './locations.js';
import { HILLSHADE_DEFAULT, inNaipCoverage } from './tiles.js';
import { ALTITUDE_FLOOR_M, ALTITUDE_CEILING_M, daySeed } from '../display/flight/orbit.js';
import { DEFAULT_WINDOW_AZIMUTH_DEG, DEFAULT_PITCH_DEG } from '../display/flight/view.js';

export { Location } from './locations.js';
export { inNaipCoverage, tileTemplates } from './tiles.js';

export interface SearchParamsSource {
	searchParams: { get(key: string): string | null };
}

function parseNum(
	params: { get(key: string): string | null },
	key: string,
	fallback: number
): number {
	const raw = params.get(key);
	if (raw === null || raw.trim() === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * The legal range of every numeric knob — the SSOT for clamping.
 */
export const KNOB_RANGE = {
	azimuthDeg: [-180, 180],
	pitchDeg: [-85, 0],
	detail: [0, 1],
	floorM: [0, 20_000],
	ceilingM: [0, 20_000],
	shade: [0, 1],
	wingScale: [0.3, 3.0],
	wingOffsetX: [-800, 800],
	wingOffsetY: [-800, 800],
	wingPitchDeg: [-45, 45],
	wingRollFactor: [0, 3.0]
} as const satisfies Record<string, readonly [number, number]>;

export type NumericKnob = keyof typeof KNOB_RANGE;

/** Wrap into -180..180 — the shortest signed bearing, not 0..360. */
function wrapSigned(deg: number): number {
	return ((((deg + 180) % 360) + 360) % 360) - 180;
}

export const DEFAULT_WING_SCALE = 0.85;
export const DEFAULT_WING_OFFSET_X = -405;
export const DEFAULT_WING_OFFSET_Y = -20;

export class PaneSettings {
	place = $state<Location>(Location.hyderabad());
	azimuthDeg = $state<number>(DEFAULT_WINDOW_AZIMUTH_DEG);
	pitchDeg = $state<number>(DEFAULT_PITCH_DEG);
	detail = $state<number>(0);
	floorM = $state<number>(ALTITUDE_FLOOR_M);
	ceilingM = $state<number>(ALTITUDE_CEILING_M);
	shade = $state<number>(HILLSHADE_DEFAULT);
	/** Which way round the orbit is flown. */
	direction = $state<1 | -1>(1);
	/** Phase offset in radians from daySeed. */
	phase = $state<number>(0);

	/** Aircraft Wing alignment knobs (Mode, X, Y, Scale, Pitch, Roll) */
	wing = $state<boolean>(true);
	wingMode = $state<'3d' | '2d'>('3d');
	wingScale = $state<number>(DEFAULT_WING_SCALE);
	wingOffsetX = $state<number>(DEFAULT_WING_OFFSET_X);
	wingOffsetY = $state<number>(DEFAULT_WING_OFFSET_Y);
	wingPitchDeg = $state<number>(0);
	wingRollFactor = $state<number>(1.0);

	constructor(initial?: Partial<PaneSettings>) {
		if (initial) Object.assign(this, initial);
	}

	applyUrl(url: SearchParamsSource): void {
		const place = Location.byId(url.searchParams.get('place'));
		this.place = place;
		this.phase = daySeed(place) * Math.PI * 2;
		this.azimuthDeg = parseNum(url.searchParams, 'azimuth', DEFAULT_WINDOW_AZIMUTH_DEG);
		this.pitchDeg = parseNum(url.searchParams, 'pitch', DEFAULT_PITCH_DEG);
		this.detail = parseNum(url.searchParams, 'detail', inNaipCoverage(place) ? 1 : 0);
		this.floorM = parseNum(url.searchParams, 'floor', place.climbFloorM);
		this.ceilingM = parseNum(url.searchParams, 'ceiling', place.climbCeilingM);
		this.shade = parseNum(url.searchParams, 'shade', HILLSHADE_DEFAULT);
		const mode = url.searchParams.get('wingMode');
		if (mode === '2d' || mode === '3d') this.wingMode = mode;
		this.wingScale = parseNum(url.searchParams, 'wingScale', DEFAULT_WING_SCALE);
		this.wingOffsetX = parseNum(url.searchParams, 'wingX', DEFAULT_WING_OFFSET_X);
		this.wingOffsetY = parseNum(url.searchParams, 'wingY', DEFAULT_WING_OFFSET_Y);
		this.wingPitchDeg = parseNum(url.searchParams, 'wingPitch', 0);
		this.wingRollFactor = parseNum(url.searchParams, 'wingRoll', 1.0);
	}

	reset(): void {
		this.azimuthDeg = DEFAULT_WINDOW_AZIMUTH_DEG;
		this.pitchDeg = DEFAULT_PITCH_DEG;
		this.shade = HILLSHADE_DEFAULT;
		this.wingMode = '3d';
		this.wingScale = DEFAULT_WING_SCALE;
		this.wingOffsetX = DEFAULT_WING_OFFSET_X;
		this.wingOffsetY = DEFAULT_WING_OFFSET_Y;
		this.wingPitchDeg = 0;
		this.wingRollFactor = 1.0;
	}

	set(key: NumericKnob, value: number): void {
		if (!Number.isFinite(value)) return;
		if (key === 'azimuthDeg') {
			this.azimuthDeg = wrapSigned(value);
			return;
		}
		const [lo, hi] = KNOB_RANGE[key];
		this[key] = Math.min(hi, Math.max(lo, value));
	}

	reverse(): void {
		this.direction = this.direction === 1 ? -1 : 1;
	}

	nudge(key: NumericKnob, delta: number): void {
		this.set(key, this[key] + delta);
	}
}

export function createSettings(initial?: Partial<PaneSettings>): PaneSettings {
	return new PaneSettings(initial);
}

export function readSettings(url: SearchParamsSource): PaneSettings {
	const s = new PaneSettings();
	s.applyUrl(url);
	return s;
}
