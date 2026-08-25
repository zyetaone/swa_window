/**
 * Atmosphere band model & continuous altitude blending rules.
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
	crossing: number
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
			skyHorizon: band.skyHorizon
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
		skyHorizon: lerpRgb(band.skyHorizon, next.skyHorizon, t)
	};
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
