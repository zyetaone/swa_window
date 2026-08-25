/**
 * Resolves altitude into atmosphere state. Pure — the Rules half of the layer
 * cake, with the authored values living in #content/atmosphere/bands.js.
 *
 * Determinism matters here more than it looks. Three Pis render three slices
 * of one window, so they must punch through a cloud deck on the SAME frame or
 * the wall visibly tears. This function is therefore a pure function of
 * altitude alone: no Math.random, no timers, no frame counters. Altitude
 * itself arrives from NTP-synced flight state, which is what keeps the panes
 * agreeing.
 */
import {
	ATMOSPHERE_BANDS,
	TRANSITION_HALF_WIDTH_M,
	type AtmosphereBand,
	type Rgb,
} from '#content/atmosphere/bands.js';

export interface AtmosphereState {
	/** Band the camera is in. During a crossing, the one it is leaving. */
	readonly bandId: string;
	/** Band being entered during a crossing, else null. */
	readonly nextBandId: string | null;
	/**
	 * How far through a boundary blend, 0..1. 0 outside a transition, 1 at the
	 * moment of crossing. This is the signal a whiteout or deck-punch reads.
	 */
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

/** Index of the band containing this altitude. Clamps below zero. */
function bandIndexAt(altitudeM: number): number {
	for (let i = 0; i < ATMOSPHERE_BANDS.length; i++) {
		if (altitudeM < ATMOSPHERE_BANDS[i].topM) return i;
	}
	return ATMOSPHERE_BANDS.length - 1;
}

/** Thickness of band `i` in metres; the open-topped final band is treated as wide. */
function thickness(i: number): number {
	const floor = i === 0 ? 0 : ATMOSPHERE_BANDS[i - 1].topM;
	const top = ATMOSPHERE_BANDS[i].topM;
	return Number.isFinite(top) ? top - floor : Number.POSITIVE_INFINITY;
}

/**
 * Blend half-width at the boundary above band `i`.
 *
 * Clamped to a fraction of the THINNER adjacent band, because a fixed width
 * silently eats bands narrower than twice itself: the ground band is 1 km tall
 * against a 600 m half-width, so its transition would span the whole band and
 * overlap the next one, leaving no altitude where "ground" actually means
 * ground. Deriving the width keeps every band's core intact no matter how the
 * heights get retuned on the wall.
 */
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

/**
 * Atmosphere state at a given altitude.
 *
 * Values are constant through the core of a band and blend only within
 * TRANSITION_HALF_WIDTH_M of a boundary. That split is deliberate: a band
 * should feel like a place you are in, not a continuous gradient you are
 * always sliding along — otherwise the crossing has nothing to be an event
 * against.
 */
export function resolveAtmosphere(altitudeM: number): AtmosphereState {
	const alt = Number.isFinite(altitudeM) ? Math.max(0, altitudeM) : 0;
	const i = bandIndexAt(alt);
	const band = ATMOSPHERE_BANDS[i];

	// Blend upward across this band's ceiling.
	const upper = ATMOSPHERE_BANDS[i + 1];
	if (upper) {
		const half = halfWidthAbove(i);
		if (alt > band.topM - half) {
			const t = Math.min((alt - (band.topM - half)) / (2 * half), 0.5);
			return stateFrom(band, upper, t, t * 2);
		}
	}

	// Blend downward across the floor shared with the band below. Expressed
	// from the lower band's perspective so ascending and descending through
	// one boundary produce identical state at the same altitude.
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
