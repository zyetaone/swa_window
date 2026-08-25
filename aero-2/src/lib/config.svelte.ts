/**
 * Aero 2 — Reactive configuration, locations, atmosphere bands, and tile definitions.
 * Svelte 5 class-based $state model with module-level export for live two-way binding.
 */

import {
	ATMOSPHERE_BANDS,
	TRANSITION_HALF_WIDTH_M,
	type AtmosphereBand,
	type AtmosphereState,
	type Rgb
} from './display/atmosphere/bands.js';
import {
	ORBIT,
	ALTITUDE_FLOOR_M,
	ALTITUDE_CEILING_M,
	CLIMB_PERIOD_SEC
} from './display/flight/orbit.js';
import { DEFAULT_WINDOW_AZIMUTH_DEG, DEFAULT_PITCH_DEG } from './display/flight/camera.js';

export {
	ATMOSPHERE_BANDS,
	TRANSITION_HALF_WIDTH_M,
	type AtmosphereBand,
	type AtmosphereState,
	type Rgb,
	ORBIT,
	ALTITUDE_FLOOR_M,
	ALTITUDE_CEILING_M,
	CLIMB_PERIOD_SEC,
	DEFAULT_WINDOW_AZIMUTH_DEG,
	DEFAULT_PITCH_DEG
};

// ── Locations ─────────────────────────────────────────────────────────────────

export class Location {
	constructor(
		readonly id: string,
		readonly lat: number,
		readonly lon: number,
		readonly timeZone: string,
		readonly utcOffset: number,
		/** Mean terrain height, metres MSL. */
		readonly groundElevationM: number,
		/** Climb envelope, metres ABOVE GROUND. Floor must clear local peaks. */
		readonly climbFloorM: number,
		readonly climbCeilingM: number
	) {}

	static hyderabad(): Location {
		return new Location('hyderabad', 17.385, 78.4867, 'Asia/Kolkata', 5.5, 500, 400, 13_000);
	}

	static denver(): Location {
		return new Location('denver', 39.7392, -104.9903, 'America/Denver', -7, 1_600, 3_000, 13_000);
	}

	static byId(id: string | null | undefined): Location {
		return id === 'denver' ? Location.denver() : Location.hyderabad();
	}
}

// ── Tuning Defaults ───────────────────────────────────────────────────────────

export const HILLSHADE_DEFAULT = 0.35;
export const HILLSHADE_SHADOW_COLOR = '#1a2436';
export const TERRAIN_EXAGGERATION = 1;

export const IMAGERY_GRADE = {
	saturation: -0.08,
	contrast: 0.06,
	resampling: 'linear' as const,
	fadeDuration: 0
};

// ── Imagery & Tile Definitions ────────────────────────────────────────────────

export const TILE_SIZE = 256;

export const TILE_MAXZOOM = {
	gibs: 9,
	usgs: 16,
	terrarium: 13
} as const;

export const TILE_ATTRIBUTION =
	'Imagery: NASA EOSDIS GIBS, USGS The National Map · Elevation: Mapzen / AWS Open Data';

export const TERRAIN_PMTILES = 'pmtiles:///api/tiles/terrain.pmtiles';

export function inNaipCoverage(loc: { lat: number; lon: number }): boolean {
	return loc.lat >= 24.5 && loc.lat <= 49.5 && loc.lon >= -125.0 && loc.lon <= -66.9;
}

export function tileTemplates(prefix = '/api/tiles'): {
	gibs: string[];
	usgs: string[];
	terrarium: string[];
} {
	return {
		gibs: [`${prefix}/xyz/gibs/{z}/{x}/{y}.jpg`],
		usgs: [`${prefix}/xyz/usgs/{z}/{x}/{y}.jpg`],
		terrarium: [`${prefix}/xyz/terrarium/{z}/{x}/{y}.png`]
	};
}

// ── Reactive PaneConfig Class ($state) ────────────────────────────────────────

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

export class PaneConfig {
	place = $state<Location>(Location.hyderabad());
	azimuthDeg = $state<number>(DEFAULT_WINDOW_AZIMUTH_DEG);
	pitchDeg = $state<number>(DEFAULT_PITCH_DEG);
	detail = $state<number>(0);
	floorM = $state<number>(ALTITUDE_FLOOR_M);
	ceilingM = $state<number>(ALTITUDE_CEILING_M);
	shade = $state<number>(HILLSHADE_DEFAULT);

	constructor(initial?: Partial<PaneConfig>) {
		if (initial) {
			if (initial.place) this.place = initial.place;
			if (initial.azimuthDeg !== undefined) this.azimuthDeg = initial.azimuthDeg;
			if (initial.pitchDeg !== undefined) this.pitchDeg = initial.pitchDeg;
			if (initial.detail !== undefined) this.detail = initial.detail;
			if (initial.floorM !== undefined) this.floorM = initial.floorM;
			if (initial.ceilingM !== undefined) this.ceilingM = initial.ceilingM;
			if (initial.shade !== undefined) this.shade = initial.shade;
		}
	}

	applyUrl(url: SearchParamsSource): void {
		const place = Location.byId(url.searchParams.get('place'));
		this.place = place;
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

	nudge(key: 'azimuthDeg' | 'pitchDeg', delta: number): void {
		if (key === 'azimuthDeg') this.azimuthDeg = (((this.azimuthDeg + delta) % 360) + 360) % 360;
		if (key === 'pitchDeg') this.pitchDeg = Math.max(-85, Math.min(0, this.pitchDeg + delta));
	}
}

export type PaneParams = PaneConfig;

/** Module-level singleton reactive configuration instance */
export const config = new PaneConfig();

export function createPaneConfig(initial?: Partial<PaneConfig>): PaneConfig {
	return new PaneConfig(initial);
}

export function readPaneConfig(url: SearchParamsSource): PaneConfig {
	const c = new PaneConfig();
	c.applyUrl(url);
	return c;
}

/** Backward-compatible alias for readPaneConfig */
export const readPaneParams = readPaneConfig;
