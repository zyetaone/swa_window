/**
 * Aero 2 — Reactive configuration, locations, atmosphere bands, and tile definitions.
 * Single source of truth (SSOT) with Svelte 5 $state for live two-way binding.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Linear RGB, 0..1. */
export type Rgb = readonly [number, number, number];

export interface AtmosphereBand {
	readonly id: string;
	readonly topM: number;
	readonly fogDensity: number;
	readonly groundDetail: number;
	readonly deckOpacity: number;
	readonly skyTop: Rgb;
	readonly skyHorizon: Rgb;
}

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

// ── Atmosphere Bands ──────────────────────────────────────────────────────────

export const ATMOSPHERE_BANDS: readonly AtmosphereBand[] = [
	{
		id: 'ground',
		topM: 1_000,
		fogDensity: 1.0e-4,
		groundDetail: 1.0,
		deckOpacity: 0.0,
		skyTop: [0.35, 0.55, 0.85],
		skyHorizon: [0.75, 0.82, 0.9]
	},
	{
		id: 'haze',
		topM: 3_000,
		fogDensity: 2.5e-4,
		groundDetail: 0.85,
		deckOpacity: 0.15,
		skyTop: [0.3, 0.5, 0.82],
		skyHorizon: [0.7, 0.78, 0.88]
	},
	{
		id: 'midDeck',
		topM: 7_000,
		fogDensity: 4.0e-4,
		groundDetail: 0.55,
		deckOpacity: 0.55,
		skyTop: [0.22, 0.42, 0.78],
		skyHorizon: [0.6, 0.72, 0.86]
	},
	{
		id: 'cirrus',
		topM: 11_000,
		fogDensity: 2.0e-4,
		groundDetail: 0.3,
		deckOpacity: 0.8,
		skyTop: [0.13, 0.3, 0.7],
		skyHorizon: [0.45, 0.6, 0.8]
	},
	{
		id: 'stratosphere',
		topM: Number.POSITIVE_INFINITY,
		fogDensity: 0.8e-4,
		groundDetail: 0.12,
		deckOpacity: 0.95,
		skyTop: [0.04, 0.12, 0.42],
		skyHorizon: [0.22, 0.38, 0.66]
	}
];

export const TRANSITION_HALF_WIDTH_M = 600;

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

export const DEFAULT_WINDOW_AZIMUTH_DEG = -90;
export const DEFAULT_PITCH_DEG = -18;

export const ORBIT = {
	driftRate: 3.42e-4,
	majorMin: 0.08,
	majorMax: 0.25,
	breathePeriod: 180,
	flightSpeed: 6.0
} as const;

export const ALTITUDE_FLOOR_M = 400;
export const ALTITUDE_CEILING_M = 13_000;
export const CLIMB_PERIOD_SEC = 900;

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

// ── Reactive PaneConfig ($state) ──────────────────────────────────────────────

/**
 * The read-only view of a pane's knobs. Consumers that only READ should take
 * `PaneParams`, not `PaneConfig`, so the type says whether they can write.
 */
export interface PaneParams {
	readonly place: Location;
	/** Where this pane looks, relative to the aircraft's track. */
	readonly azimuthDeg: number;
	/** Depression below the horizon. Negative looks down. */
	readonly pitchDeg: number;
	/** Opacity of the US-only detail imagery, 0..1. 0 unmounts the layer. */
	readonly detail: number;
	/** Climb envelope, metres above ground. */
	readonly floorM: number;
	readonly ceilingM: number;
	/** Hillshade exaggeration. */
	readonly shade: number;
}

/**
 * Live, reactive pane config — the SSOT a control surface writes to.
 *
 * `$state` here is deliberate and forward-looking: v1 ships an operator
 * SidePanel of live sliders over exactly these knobs, and aero-2 will want the
 * same. Reading `config.shade` inside a component or `$derived` re-renders on
 * change, which is the whole point.
 *
 * ONE constraint, and it is about `bind:` rather than about `$state`:
 *
 *   reading  config.shade          → fine, anywhere
 *   `bind:value={config.shade}`    → NO
 *
 * On a three-Pi wall a write is not merely a local mutation. It has to be
 * validated, merged (v1 uses a CRDT LWW register), and broadcast so the panes
 * keep showing one continuous window. v1 funnels every operator write through a
 * single `applyConfigPatch` gate for that reason. `bind:` reaches in and sets
 * the field directly, skipping the gate, and the wall silently desyncs — one
 * pane hazier than its neighbour, with nothing in the logs.
 *
 * So when the control surface lands: a `set(key, value)` / patch method on this
 * class that can also broadcast, and sliders call that. Not `bind:`.
 *
 * Pose stays a pure function of (wall-clock time, params) regardless — that is
 * what lets three devices agree without an inter-device protocol.
 */
export class PaneConfig implements PaneParams {
	place = $state<Location>(Location.hyderabad());
	azimuthDeg = $state<number>(DEFAULT_WINDOW_AZIMUTH_DEG);
	pitchDeg = $state<number>(DEFAULT_PITCH_DEG);
	detail = $state<number>(0);
	floorM = $state<number>(ALTITUDE_FLOOR_M);
	ceilingM = $state<number>(ALTITUDE_CEILING_M);
	shade = $state<number>(HILLSHADE_DEFAULT);

	constructor(initial?: Partial<PaneParams>) {
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
}

export function createPaneConfig(initial?: Partial<PaneParams>): PaneConfig {
	return new PaneConfig(initial);
}

// ── URL Query Parser → PaneConfig ─────────────────────────────────────────────

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

export function readPaneConfig(url: SearchParamsSource): PaneConfig {
	const place = Location.byId(url.searchParams.get('place'));
	const autoDetail = inNaipCoverage(place) ? 1 : 0;

	return new PaneConfig({
		place,
		azimuthDeg: parseNum(url.searchParams, 'azimuth', DEFAULT_WINDOW_AZIMUTH_DEG),
		pitchDeg: parseNum(url.searchParams, 'pitch', DEFAULT_PITCH_DEG),
		detail: parseNum(url.searchParams, 'detail', autoDetail),
		floorM: parseNum(url.searchParams, 'floor', place.climbFloorM),
		ceilingM: parseNum(url.searchParams, 'ceiling', place.climbCeilingM),
		shade: parseNum(url.searchParams, 'shade', HILLSHADE_DEFAULT)
	});
}

/** Backward-compatible alias for readPaneConfig */
export const readPaneParams = readPaneConfig;
