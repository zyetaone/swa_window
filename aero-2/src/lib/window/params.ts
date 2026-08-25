/**
 * The kiosk's URL knobs, parsed once.
 *
 * Pure: takes a `URL`, returns values. That is what lets `+page.ts` read them
 * during `load` and a test read them without a browser — the component never
 * touches `location` itself.
 */

import {
	DEFAULT_PITCH_DEG,
	DEFAULT_WINDOW_AZIMUTH_DEG,
	HILLSHADE_DEFAULT
} from '#lib/window/config.js';
import { Location } from '#lib/world/locations.js';
import { inNaipCoverage } from '#lib/world/imagery/tiles.js';

export interface WindowParams {
	readonly place: Location;
	/** Where this pane looks, relative to the aircraft's track. */
	readonly azimuthDeg: number;
	/** Depression below the horizon. Negative looks down. */
	readonly pitchDeg: number;
	/** Opacity of the high-detail imagery layer, 0..1. */
	readonly detail: number;
	readonly floorM: number;
	readonly ceilingM: number;
	readonly shade: number;
}

/**
 * `Number('')` is 0 and `Number('abc')` is NaN, and a NaN azimuth silently
 * parks the camera at a NaN target — a black screen with no thrown error.
 * Every knob goes through here so a typo in a kiosk URL falls back instead.
 */
function num(params: URLSearchParams, key: string, fallback: number): number {
	const raw = params.get(key);
	if (raw === null || raw.trim() === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

export function readWindowParams(url: URL): WindowParams {
	const q = url.searchParams;
	// Location.byId's own default is hyderabad — the fielded kiosk's home.
	const place = Location.byId(q.get('place'));

	return {
		place,
		azimuthDeg: num(q, 'azimuth', DEFAULT_WINDOW_AZIMUTH_DEG),
		pitchDeg: num(q, 'pitch', DEFAULT_PITCH_DEG),
		// NAIP is US-only, so elsewhere the layer is off and GIBS shows through.
		// `?detail=0` forces that floor anywhere, which is what Hyderabad gets and
		// therefore what the real kiosk looks like today.
		detail: num(q, 'detail', inNaipCoverage(place) ? 1 : 0),
		// The climb envelope is THE open ADR-005 question, so it stays a knob
		// rather than a commit. Try `?floor=2500` to compare.
		floorM: num(q, 'floor', place.climbFloorM),
		ceilingM: num(q, 'ceiling', place.climbCeilingM),
		// `?shade=0` to compare. Hillshade is free structure: it comes off the DEM
		// we already fetch, and the eye reads ridgelines as "sharp" far more
		// readily than it counts pixels.
		shade: num(q, 'shade', HILLSHADE_DEFAULT)
	};
}
