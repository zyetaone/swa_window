/**
 * Shared types — single source of truth for domain types used across
 * display, admin, fleet server, and any future package.
 *
 * This is the SSOT. `src/lib/core/types.ts` re-exports from here.
 */

export type SkyState = 'day' | 'night' | 'dawn' | 'dusk';

export type LocationId =
	| 'dubai'
	| 'himalayas'
	| 'mumbai'
	| 'ocean'
	| 'desert'
	| 'clouds'
	| 'hyderabad'
	| 'dallas'
	| 'phoenix'
	| 'las_vegas'
	| 'denver'
	| 'chicago_midway'
	| 'baltimore'
	| 'houston'
	| 'nashville'
	| 'oakland'
	| 'austin'
	| 'atlanta';

export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'overcast' | 'storm';

export interface SceneDefaults {
	fog: { dayDensity: number; nightDensity: number; dayBrightness: number; nightBrightness: number };
	clouds: { density: number; speed: number };
	terrain: { exaggeration: number };
}

export interface Location {
	id: LocationId;
	name: string;
	lat: number;
	lon: number;
	utcOffset: number;
	hasBuildings: boolean;
	defaultAltitude: number;
	nightAltitude: number;
	scene: SceneDefaults;
}
