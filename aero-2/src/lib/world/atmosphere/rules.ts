/**
 * Which band the aircraft is in, and the blend across a boundary.
 */
import {
	ATMOSPHERE_BANDS,
	TRANSITION_HALF_WIDTH_M,
	type AtmosphereBand,
	type Rgb,
} from '#lib/world/atmosphere/model.js';

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
	crossing: number,
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
			skyHorizon: band.skyHorizon,
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
		skyHorizon: lerpRgb(band.skyHorizon, next.skyHorizon, t),
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
