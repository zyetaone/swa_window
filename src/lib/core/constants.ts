/**
 * Re-export of shared application constants. SSOT lives in `$lib/shared/constants`.
 * Kept here so existing `./constants` relative imports inside `core/`
 * continue to work without path changes.
 */
export {
	AIRCRAFT,
	FLIGHT_FEEL,
	AMBIENT,
	MICRO_EVENTS,
	CESIUM,
	WEATHER_EFFECTS,
} from '$lib/shared/constants';
export type { WeatherEffect } from '$lib/shared/constants';
