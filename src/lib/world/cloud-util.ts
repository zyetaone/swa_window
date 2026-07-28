/**
 * Cloud density math — weather-dependent effective density.
 *
 * Encapsulates the weather floor (rain/storm force a minimum) and the
 * dim-at-night / slight-dim-at-dusk policy. Consumed by AeroWindow.
 */
import { clamp } from '$lib/utils';
import { WEATHER_EFFECTS } from '$content/weather';
import type { WeatherType, SkyState } from '$lib/types';

export function effectiveCloudDensity(
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
