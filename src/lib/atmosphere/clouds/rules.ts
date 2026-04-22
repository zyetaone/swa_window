/**
 * Cloud density rules — pure functions for weather/skyState-driven density.
 *
 * Extracted from AeroWindow.effectiveCloudDensity so the logic is testable
 * without a SvelteKit runtime and discoverable next to the ArtsyClouds
 * renderer. AeroWindow's derived getter now calls `effectiveCloudDensity`
 * with its reactive inputs.
 */

import { clamp } from '$lib/utils';
import { WEATHER_EFFECTS } from '$lib/constants';
import type { WeatherType, SkyState } from '$lib/types';

/**
 * Effective cloud density given weather type, raw density slider value,
 * and current sky state. Encapsulates the weather floor (rain/storm force
 * a minimum) and the dim-at-night / slight-dim-at-dusk policy.
 *
 * @param weather   Active weather type (drives cloudDensityRange + night floor)
 * @param raw       Raw density from config.atmosphere.clouds.density (0..1)
 * @param skyState  Current sky state — dims the output at dusk/night
 */
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
