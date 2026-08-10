/**
 * Atmosphere rules — pure density/weather helpers for the reactive model.
 * Complexity lives here (Rules), not on AeroWindow (data + orchestration).
 */
import { clamp } from '$lib/utils';
import { WEATHER_EFFECTS } from '$content/weather';
import type { SkyState, WeatherType } from '$lib/types';

/** Clamp authored cloud density by weather recipe + sky phase. */
export function effectiveCloudDensityFor(
	weather: WeatherType,
	raw: number,
	skyState: SkyState,
): number {
	const fx = WEATHER_EFFECTS[weather];
	const [min, max] = fx.cloudDensityRange;
	let d = max > 0 ? clamp(raw, min, max) : raw * 0.3;
	if (skyState === 'night') d = Math.max(d * 0.5, fx.nightCloudFloor);
	else if (skyState === 'dusk') d *= 0.7;
	return d;
}
