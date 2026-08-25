/**
 * Kiosk tuning constants and URL parameter parser.
 */

import { Location } from '#lib/config/locations.js';
import { inNaipCoverage } from '#lib/config/imagery.js';
import {
	DEFAULT_WINDOW_AZIMUTH_DEG,
	DEFAULT_PITCH_DEG,
	HILLSHADE_DEFAULT,
	type WindowParams
} from '#lib/config/window.js';

export type { WindowParams };

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
