/**
 * URL knobs → `PaneParams`.
 *
 * The ONLY thing that reads the query string. Pure: takes a `URL`, returns
 * values, so `+page.ts` can call it in `load` and a test can call it without a
 * browser. Named for what it parses rather than the vague "params", because the
 * thing it produces is also called params.
 */

import { Location } from '#lib/config/locations.js';
import { inNaipCoverage } from '#lib/config/imagery.js';
import {
	DEFAULT_WINDOW_AZIMUTH_DEG,
	DEFAULT_PITCH_DEG,
	HILLSHADE_DEFAULT,
	type PaneParams
} from '#lib/domain/pane.js';

export type { PaneParams };

function num(params: URLSearchParams, key: string, fallback: number): number {
	const raw = params.get(key);
	if (raw === null || raw.trim() === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

export function readPaneParams(url: URL): PaneParams {
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
