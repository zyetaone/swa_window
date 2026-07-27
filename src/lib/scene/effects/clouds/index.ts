import type { Effect } from '$lib/scene/types';
import { Z } from '$lib/scene/layers';
import { clamp } from '$lib/utils';
import { WEATHER_EFFECTS } from '$content/weather';
import type { WeatherType, SkyState } from '$lib/types';
import Clouds from './ArtsyClouds.svelte';

const clouds: Effect = {
	id: 'clouds',
	kind: 'sky',
	z: Z.clouds,
	// Self-disable when the Three overlay is on (hybrid-v2): world/three/Clouds
	// takes over, so the CSS3D deck would otherwise double the clouds.
	when: (model) => model.config.world.showClouds && !model.config.world.useThreeOverlay,
	component: Clouds,
};

export { clouds };

/**
 * Effective cloud density given weather type, raw density slider value,
 * and current sky state. Encapsulates the weather floor (rain/storm force
 * a minimum) and the dim-at-night / slight-dim-at-dusk policy.
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
