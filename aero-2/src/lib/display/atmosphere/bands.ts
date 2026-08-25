/**
 * Atmospheric bands, continuous altitude transitions, and sky/fog color blending.
 * Pure deterministic mathematics — rune-free and renderer-free.
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

export const TRANSITION_HALF_WIDTH_M = 200;

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
	return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function blendAtmosphere(a: AtmosphereBand, b: AtmosphereBand, t: number): AtmosphereState {
	const clamped = Math.max(0, Math.min(1, t));
	const smooth = clamped * clamped * (3 - 2 * clamped);

	return {
		bandId: a.id,
		nextBandId: b.id,
		crossing: smooth,
		fogDensity: lerp(a.fogDensity, b.fogDensity, smooth),
		groundDetail: lerp(a.groundDetail, b.groundDetail, smooth),
		deckOpacity: lerp(a.deckOpacity, b.deckOpacity, smooth),
		skyTop: lerpRgb(a.skyTop, b.skyTop, smooth),
		skyHorizon: lerpRgb(a.skyHorizon, b.skyHorizon, smooth)
	};
}

export function resolveAtmosphere(aglM: number): AtmosphereState {
	const h = Math.max(0, aglM);
	const bands = ATMOSPHERE_BANDS;

	for (let i = 0; i < bands.length; i++) {
		const cur = bands[i];
		const next = bands[i + 1];

		if (!next) {
			return {
				bandId: cur.id,
				nextBandId: null,
				crossing: 0,
				fogDensity: cur.fogDensity,
				groundDetail: cur.groundDetail,
				deckOpacity: cur.deckOpacity,
				skyTop: cur.skyTop,
				skyHorizon: cur.skyHorizon
			};
		}

		const boundary = cur.topM;
		const low = boundary - TRANSITION_HALF_WIDTH_M;
		const high = boundary + TRANSITION_HALF_WIDTH_M;

		if (h < low) {
			return {
				bandId: cur.id,
				nextBandId: null,
				crossing: 0,
				fogDensity: cur.fogDensity,
				groundDetail: cur.groundDetail,
				deckOpacity: cur.deckOpacity,
				skyTop: cur.skyTop,
				skyHorizon: cur.skyHorizon
			};
		}

		if (h <= high) {
			const t = (h - low) / (high - low);
			return blendAtmosphere(cur, next, t);
		}
	}

	const top = bands[bands.length - 1];
	return {
		bandId: top.id,
		nextBandId: null,
		crossing: 0,
		fogDensity: top.fogDensity,
		groundDetail: top.groundDetail,
		deckOpacity: top.deckOpacity,
		skyTop: top.skyTop,
		skyHorizon: top.skyHorizon
	};
}
