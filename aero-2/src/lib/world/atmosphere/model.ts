/**
 * The layer cake — what the sky looks like at each height.
 * Model: shapes and their canonical values. No logic, no imports.
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
