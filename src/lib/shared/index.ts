/**
 * $lib/shared — SSOT barrel for types, constants, locations, protocol, utils.
 *
 * Consumed by display (`src/lib/core/*` re-exports), admin route,
 * fleet server, and any other package. Do not duplicate symbols
 * from this barrel elsewhere.
 */

export type { SkyState, LocationId, WeatherType, Location } from './types';

export {
	AIRCRAFT,
	FLIGHT_FEEL,
	AMBIENT,
	MICRO_EVENTS,
	CESIUM,
	WEATHER_EFFECTS,
} from './constants';
export type { WeatherEffect } from './constants';

export { LOCATIONS, LOCATION_IDS, LOCATION_MAP } from './locations';

export { clamp, lerp, normalizeHeading, formatTime } from './utils';

export type {
	ServerMessage,
	ServerAdminMessage,
	DisplayMessage,
	DeviceCaps,
	DisplayConfig,
	DeviceInfo,
	DisplayMode,
} from './protocol';
