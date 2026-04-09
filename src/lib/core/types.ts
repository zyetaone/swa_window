/**
 * Re-export of shared types. SSOT lives in `$lib/shared/types`.
 * Kept here so existing `./types` relative imports inside `core/`
 * continue to work without path changes.
 */
export type { SkyState, LocationId, WeatherType, Location } from '$lib/shared/types';
