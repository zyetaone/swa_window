/**
 * Reactive PaneSettings class ($state) and URL query parser.
 * Single source of truth for all live simulation knobs.
 */

import { Location } from './locations.js';
import { HILLSHADE_DEFAULT, TERRAIN_EXAGGERATION, inNaipCoverage } from './tiles.js';
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
	pitchDeg: [-89, 30],
	speed: [0.1, 25.0],
	detail: [0, 1],
	floorM: [0, 20_000],
	ceilingM: [0, 20_000],
	shade: [0, 1],
	exaggeration: [0.1, 6.0],
	wingScale: [0.3, 3.0],
	wingOffsetX: [-800, 800],
	wingOffsetY: [-800, 800],
	wingPitchDeg: [-45, 45],
	wingRollFactor: [0, 3.0],
	cloudDensity: [0, 1.0],
	cloudSpeed: [0, 5.0],
	cloudAltitudeM: [500, 12_000],
	cloudOpacity: [0.1, 1.0]
} as const satisfies Record<string, readonly [number, number]>;

export type NumericKnob = keyof typeof KNOB_RANGE;

/** Wrap into -180..180 — the shortest signed bearing, not 0..360. */
function wrapSigned(deg: number): number {
	return ((((deg + 180) % 360) + 360) % 360) - 180;
}

export const DEFAULT_WING_SCALE = 0.65;
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
	/** 3D Terrain elevation mesh exaggeration (default 2.5x). */
	exaggeration = $state<number>(TERRAIN_EXAGGERATION);
	/** Optional hypsometric color relief tint layer. */
	colorRelief = $state<boolean>(false);
	reliefRamp = $state<'geographical' | 'LINZ'>('geographical');
	/** Flight speed multiplier (default 4.0x). */
	speed = $state<number>(4.0);
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

	/** Atmospheric Cloud deck layer knobs */
	clouds = $state<boolean>(true);
	cloudDensity = $state<number>(0.75);
	cloudSpeed = $state<number>(1.0);
	cloudAltitudeM = $state<number>(3500);
	cloudOpacity = $state<number>(0.85);

	constructor(initial?: Partial<PaneSettings>) {
		if (initial) Object.assign(this, initial);
	}

	/**
	 * Move to a location, and bring everything the location DEFINES with it.
	 *
	 * `detail`, `floorM`, `ceilingM` and `phase` are not independent settings —
	 * they are facts about the place. Setting `place` alone leaves them
	 * describing the previous one, and `detail` is the expensive case: it gates
	 * the US-only USGS layer, so carrying Denver's `1` across to Hyderabad
	 * mounts a layer with no coverage there and streams 404s at the tile server
	 * indefinitely. That exact failure has now regressed four times, each time
	 * because a caller set some of these fields and not the rest.
	 *
	 * So there is one gate. Call this, never assign `place` directly.
	 */
	setPlace(place: Location): void {
		this.place = place;
		this.phase = daySeed(place) * Math.PI * 2;
		this.detail = inNaipCoverage(place) ? 1 : 0;
		this.floorM = place.climbFloorM;
		this.ceilingM = place.climbCeilingM;
	}

	applyUrl(url: SearchParamsSource): void {
		const place = Location.byId(url.searchParams.get('place'));
		this.setPlace(place);
		this.azimuthDeg = parseNum(url.searchParams, 'azimuth', DEFAULT_WINDOW_AZIMUTH_DEG);
		this.pitchDeg = parseNum(url.searchParams, 'pitch', DEFAULT_PITCH_DEG);
		this.detail = parseNum(url.searchParams, 'detail', this.detail);
		this.floorM = parseNum(url.searchParams, 'floor', this.floorM);
		this.ceilingM = parseNum(url.searchParams, 'ceiling', this.ceilingM);
		this.shade = parseNum(url.searchParams, 'shade', HILLSHADE_DEFAULT);
		this.exaggeration = parseNum(url.searchParams, 'exaggeration', TERRAIN_EXAGGERATION);
		const crParam = url.searchParams.get('colorRelief');
		if (crParam !== null) this.colorRelief = crParam === '1' || crParam === 'true';
		const rampParam = url.searchParams.get('ramp');
		if (rampParam === 'LINZ' || rampParam === 'geographical') this.reliefRamp = rampParam;
		this.speed = parseNum(url.searchParams, 'speed', 4.0);
		const mode = url.searchParams.get('wingMode');
		if (mode === '2d' || mode === '3d') this.wingMode = mode;
		this.wingScale = parseNum(url.searchParams, 'wingScale', DEFAULT_WING_SCALE);
		this.wingOffsetX = parseNum(url.searchParams, 'wingX', DEFAULT_WING_OFFSET_X);
		this.wingOffsetY = parseNum(url.searchParams, 'wingY', DEFAULT_WING_OFFSET_Y);
		this.wingPitchDeg = parseNum(url.searchParams, 'wingPitch', 0);
		this.wingRollFactor = parseNum(url.searchParams, 'wingRoll', 1.0);
		const cloudsParam = url.searchParams.get('clouds');
		if (cloudsParam !== null) this.clouds = cloudsParam !== '0' && cloudsParam !== 'false';
		this.cloudDensity = parseNum(url.searchParams, 'cloudDensity', 0.75);
		this.cloudSpeed = parseNum(url.searchParams, 'cloudSpeed', 1.0);
		this.cloudAltitudeM = parseNum(url.searchParams, 'cloudAlt', 3500);
		this.cloudOpacity = parseNum(url.searchParams, 'cloudOpacity', 0.85);
	}

	reset(): void {
		this.azimuthDeg = DEFAULT_WINDOW_AZIMUTH_DEG;
		this.pitchDeg = DEFAULT_PITCH_DEG;
		this.shade = HILLSHADE_DEFAULT;
		this.exaggeration = TERRAIN_EXAGGERATION;
		this.colorRelief = false;
		this.reliefRamp = 'geographical';
		this.speed = 4.0;
		this.wingMode = '3d';
		this.wingScale = DEFAULT_WING_SCALE;
		this.wingOffsetX = DEFAULT_WING_OFFSET_X;
		this.wingOffsetY = DEFAULT_WING_OFFSET_Y;
		this.wingPitchDeg = 0;
		this.wingRollFactor = 1.0;
		this.clouds = true;
		this.cloudDensity = 0.75;
		this.cloudSpeed = 1.0;
		this.cloudAltitudeM = 3500;
		this.cloudOpacity = 0.85;
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
