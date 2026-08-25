/**
 * The kiosk's URL knobs, parsed once.
 */

import { DEFAULT_PITCH_DEG, DEFAULT_WINDOW_AZIMUTH_DEG, HILLSHADE_DEFAULT } from './config.js';
import { Location } from '#lib/flight/locations.js';
import { inNaipCoverage } from '#lib/stage/imagery.js';

export interface WindowParams {
	readonly place: Location;
	readonly azimuthDeg: number;
	readonly pitchDeg: number;
	readonly detail: number;
	readonly floorM: number;
	readonly ceilingM: number;
	readonly shade: number;
}

function num(params: URLSearchParams, key: string, fallback: number): number {
	const raw = params.get(key);
	if (raw === null || raw.trim() === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

export function readWindowParams(url: URL): WindowParams {
	const q = url.searchParams;
	const place = Location.byId(q.get('place'));

	return {
		place,
		azimuthDeg: num(q, 'azimuth', DEFAULT_WINDOW_AZIMUTH_DEG),
		pitchDeg: num(q, 'pitch', DEFAULT_PITCH_DEG),
		detail: num(q, 'detail', inNaipCoverage(place) ? 1 : 0),
		floorM: num(q, 'floor', place.climbFloorM),
		ceilingM: num(q, 'ceiling', place.climbCeilingM),
		shade: num(q, 'shade', HILLSHADE_DEFAULT)
	};
}
