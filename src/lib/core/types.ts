/**
 * Core type definitions
 * Only types that are actively used in the codebase
 */

export type SkyState = 'day' | 'night' | 'dawn' | 'dusk';

export interface SunPosition {
	x: number;
	y: number;
	z: number;
	azimuth: number;
	height: number;
}

export type ViewType =
	| 'dubai'
	| 'mumbai'
	| 'hyderabad'
	| 'dallas'
	| 'phoenix'
	| 'las_vegas'
	| 'himalayas'
	| 'ocean'
	| 'desert'
	| 'clouds';

export interface GeoCoordinate {
	lat: number;
	lon: number;
	altitude?: number;
}
