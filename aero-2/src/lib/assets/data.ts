/**
 * Authored tuning data — atmosphere bands, imagery sources, LOD numbers.
 */

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

export const ATMOSPHERE_BANDS: readonly AtmosphereBand[] = [
	{
		id: 'ground',
		topM: 1_000,
		fogDensity: 1.0e-4,
		groundDetail: 1.0,
		deckOpacity: 0.0,
		skyTop: [0.35, 0.55, 0.85],
		skyHorizon: [0.75, 0.82, 0.9],
	},
	{
		id: 'haze',
		topM: 3_000,
		fogDensity: 2.5e-4,
		groundDetail: 0.85,
		deckOpacity: 0.15,
		skyTop: [0.3, 0.5, 0.82],
		skyHorizon: [0.7, 0.78, 0.88],
	},
	{
		id: 'midDeck',
		topM: 7_000,
		fogDensity: 4.0e-4,
		groundDetail: 0.55,
		deckOpacity: 0.55,
		skyTop: [0.22, 0.42, 0.78],
		skyHorizon: [0.6, 0.72, 0.86],
	},
	{
		id: 'cirrus',
		topM: 11_000,
		fogDensity: 2.0e-4,
		groundDetail: 0.3,
		deckOpacity: 0.8,
		skyTop: [0.13, 0.3, 0.7],
		skyHorizon: [0.45, 0.6, 0.8],
	},
	{
		id: 'stratosphere',
		topM: Number.POSITIVE_INFINITY,
		fogDensity: 0.8e-4,
		groundDetail: 0.12,
		deckOpacity: 0.95,
		skyTop: [0.04, 0.12, 0.42],
		skyHorizon: [0.22, 0.38, 0.66],
	},
];

export const TRANSITION_HALF_WIDTH_M = 600;

/**
 * The climb profile — what actually moves the aircraft through the bands.
 *
 * Floor sits inside `ground` and the ceiling inside `stratosphere`, so a full
 * cycle visits every band rather than parking in one. Wall-clock driven, so the
 * three panes climb together.
 */
export const ALTITUDE_FLOOR_M = 400;
export const ALTITUDE_CEILING_M = 13_000;
export const CLIMB_PERIOD_SEC = 900;

export interface ImagerySource {
	readonly id: string;
	readonly urlTemplate: string;
	readonly zoomRange: readonly [number, number];
	readonly nightAnchor: number;
}

export const IMAGERY_SOURCES: readonly ImagerySource[] = [
	{
		id: 'eox-sentinel2',
		urlTemplate: '/api/tiles/eox-sentinel2/{z}/{y}/{x}.jpg',
		zoomRange: [4, 12],
		nightAnchor: 0,
	},
	{
		id: 'esri-world-imagery',
		urlTemplate: '/api/tiles/esri-world-imagery/{z}/{y}/{x}.jpg',
		zoomRange: [4, 14],
		nightAnchor: 0.01,
	},
	{
		id: 'cartodb-dark',
		urlTemplate: '/api/tiles/cartodb-dark/{z}/{y}/{x}.png',
		zoomRange: [4, 12],
		nightAnchor: 1,
	},
];

/** Day layers in preference order (matches v1 local cache). */
export const DAY_IMAGERY_IDS = ['eox-sentinel2', 'esri-world-imagery'] as const;
export const SSE_GROUND = 2;
export const SSE_CRUISE = 24;
