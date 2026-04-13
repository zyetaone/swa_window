/**
 * Domain Types — Single Source of Truth.
 *
 * All domain types for display, admin, fleet, and simulation live here.
 * Runtime validation arrays derive from const arrays (DRY: type + validator in one place).
 */

// ─── Const-array-derived unions (runtime + compile-time SSOT) ────────────────

export const WEATHER_TYPES = ['clear', 'cloudy', 'rain', 'overcast', 'storm'] as const;
export type WeatherType = typeof WEATHER_TYPES[number];

export const DISPLAY_MODES = ['flight', 'screensaver', 'video'] as const;
export type DisplayMode = typeof DISPLAY_MODES[number];

export const QUALITY_MODES = ['performance', 'balanced', 'ultra'] as const;
export type QualityMode = typeof QUALITY_MODES[number];

// ─── Core domain types ───────────────────────────────────────────────────────

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

// ─── Simulation types ────────────────────────────────────────────────────────

/** Universal context passed to all simulation engines each frame. */
export interface SimulationContext {
	time: number;
	lat: number;
	lon: number;
	altitude: number;
	heading: number;
	pitch: number;
	bankAngle: number;
	weather: WeatherType;
	skyState: SkyState;
	nightFactor: number;
	dawnDuskFactor: number;
	locationId: LocationId;
	userAdjustingAltitude: boolean;
	userAdjustingTime: boolean;
	userAdjustingAtmosphere: boolean;
	cloudDensity: number;
	cloudSpeed: number;
	haze: number;
	turbulenceLevel: 'light' | 'moderate' | 'severe';
	/** WorldEngine-specific (populated only for world.tick) */
	showLightning?: boolean;
	isOrbitMode?: boolean;
	pickNextLocation?: () => LocationId;
}

// ─── Engine patch types ──────────────────────────────────────────────────────

export type FlightMode = 'orbit' | 'cruise_departure' | 'cruise_transit';

export interface FlightPatch {
	blindOpen?: boolean;
	locationArrived?: LocationId;
	resetDirector?: boolean;
}

export interface AtmospherePatch {
	cloudDensity?: number;
	cloudSpeed?: number;
	haze?: number;
	weather?: WeatherType;
}

export interface WorldPatch {
	atmosphere?: AtmospherePatch;
	nextLocation?: LocationId | null;
}

export interface MicroEventData {
	type: 'shooting-star' | 'bird' | 'contrail';
	elapsed: number;
	duration: number;
	x: number;
	y: number;
}

// ─── Scenario types ──────────────────────────────────────────────────────────

export interface Waypoint {
	lat: number;
	lon: number;
	altitude: number;
	heading: number;
	duration: number;
}

export interface FlightScenario {
	id: string;
	locationId: LocationId;
	name: string;
	waypoints: Waypoint[];
	loop: boolean;
	preferredTime: 'any' | 'day' | 'night' | 'dawn' | 'dusk';
}
