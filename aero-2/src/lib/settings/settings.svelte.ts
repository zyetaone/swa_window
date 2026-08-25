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
 *
 * The sliders in `Settings.svelte` and the `nudge()` gate previously carried
 * their own copies of these bounds, and they disagreed: `nudge('azimuthDeg')`
 * wrapped into 0..360 while the slider and `applyUrl` both used -180..180, so
 * one press of "pan left" from the -90 default produced 255 — a real value,
 * off the end of its own slider.
 *
 * One table. Everything that writes a knob reads it from here.
 */
export const KNOB_RANGE = {
	azimuthDeg: [-180, 180],
	pitchDeg: [-85, 0],
	detail: [0, 1],
	floorM: [0, 20_000],
	ceilingM: [0, 20_000],
	shade: [0, 1]
} as const satisfies Record<string, readonly [number, number]>;

export type NumericKnob = keyof typeof KNOB_RANGE;

/** Wrap into -180..180 — the shortest signed bearing, not 0..360. */
function wrapSigned(deg: number): number {
	return ((((deg + 180) % 360) + 360) % 360) - 180;
}

export class PaneSettings {
	place = $state<Location>(Location.hyderabad());
	azimuthDeg = $state<number>(DEFAULT_WINDOW_AZIMUTH_DEG);
	pitchDeg = $state<number>(DEFAULT_PITCH_DEG);
	detail = $state<number>(0);
	floorM = $state<number>(ALTITUDE_FLOOR_M);
	ceilingM = $state<number>(ALTITUDE_CEILING_M);
	shade = $state<number>(HILLSHADE_DEFAULT);
	/** Which way round the orbit is flown. Not a numeric knob — it has two values. */
	direction = $state<1 | -1>(1);
	/**
	 * Where on the loop the flight starts, in radians. Seeded from the day and
	 * the place so the orbit shifts between days but never between panes.
	 */
	phase = $state<number>(0);

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
	}

	reset(): void {
		this.azimuthDeg = DEFAULT_WINDOW_AZIMUTH_DEG;
		this.pitchDeg = DEFAULT_PITCH_DEG;
		this.shade = HILLSHADE_DEFAULT;
	}

	/**
	 * The single write gate for numeric knobs: clamps (or wraps, for a bearing)
	 * into `KNOB_RANGE`, and ignores NaN.
	 *
	 * Use this rather than `bind:value={config.x}` or a bare assignment. A write
	 * is not just a local mutation on a three-Pi wall — it has to land in a legal
	 * range, and later be validated, merged and broadcast so the panes keep
	 * showing one continuous window. Fleet sync hooks in here and nowhere else.
	 */
	set(key: NumericKnob, value: number): void {
		if (!Number.isFinite(value)) return;
		if (key === 'azimuthDeg') {
			this.azimuthDeg = wrapSigned(value);
			return;
		}
		const [lo, hi] = KNOB_RANGE[key];
		this[key] = Math.min(hi, Math.max(lo, value));
	}

	/** Fly the loop the other way round. */
	reverse(): void {
		this.direction = this.direction === 1 ? -1 : 1;
	}

	/** Nudge a knob by a delta, through the same gate. */
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
