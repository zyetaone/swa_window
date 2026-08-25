/**
 * The atmosphere as a layer cake — authored data, no logic.
 *
 * The shipping app treats altitude as a dimmer on one ground-based scene:
 * climb, and ground detail fades toward nothing. The limit of fading is
 * emptiness, which is the shared root of the 35k-ft night void, the
 * night-clouds black-void show, and the nightAltitude fudge locations carry
 * to dodge both.
 *
 * Here altitude has positive content instead. Each band is a place with its
 * own look, and the cloud deck you climb above becomes a FLOOR rather than an
 * absence — which is what fills the frame at cruise.
 *
 * Values are constant inside a band and blend only near boundaries, so the
 * interesting moment is the crossing: punching up through a deck and coming
 * out on top. See resolveAtmosphere() for how that blend works.
 *
 * Tuning note: these are starting points, not measurements. The right values
 * are whatever reads correctly on the wall — expect to move them.
 */

/** Linear RGB, 0..1. Arrays rather than hex so blending needs no parsing. */
export type Rgb = readonly [number, number, number];

export interface AtmosphereBand {
	readonly id: string;
	/** Exclusive top of this band in metres. The final band must be Infinity. */
	readonly topM: number;
	/** Cesium `scene.fog.density`. Higher = thicker haze = cheaper far field. */
	readonly fogDensity: number;
	/** How legible the ground is: 1 full detail, 0 nothing. */
	readonly groundDetail: number;
	/** Opacity of the cloud deck seen from above — the floor at cruise. */
	readonly deckOpacity: number;
	/** Sky colour at the zenith. */
	readonly skyTop: Rgb;
	/** Sky colour at the horizon. */
	readonly skyHorizon: Rgb;
}

/**
 * Ordered ground-up. Boundaries follow real atmospheric structure, which is
 * why the top band starts near the tropopause (~11 km): above it there is no
 * weather, and the sky darkens toward space.
 */
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

/**
 * Half-width of the blend either side of a band boundary, in metres.
 *
 * Wide enough that a crossing reads as an event rather than a pop, narrow
 * enough that each band still has a stable core where nothing drifts.
 */
export const TRANSITION_HALF_WIDTH_M = 600;
