/**
 * Domain Types — Single Source of Truth.
 *
 * All domain types for display, admin, fleet, and simulation live here.
 * Runtime validation arrays derive from const arrays (DRY: type + validator in one place).
 *
 * Location-specific types (LocationId, Location, SceneDefaults) live in
 * locations.ts — re-exported here for convenience.
 */

// Re-export location types — LocationId is derived from the LOCATIONS array
// so adding a location never requires a manual update here. Imported locally
// because re-exports don't bring symbols into this file's scope.
import type { LocationId } from './locations';
export type { LocationId, Location, SceneDefaults } from './locations';

import type { CameraConfig } from './model/config/camera';
import type { DirectorConfig } from './model/config/director';

// ─── Const-array-derived unions (runtime + compile-time SSOT) ────────────────

export const WEATHER_TYPES = ['clear', 'cloudy', 'rain', 'overcast', 'storm'] as const;
export type WeatherType = typeof WEATHER_TYPES[number];

export const DISPLAY_MODES = ['flight', 'screensaver', 'video'] as const;
export type DisplayMode = typeof DISPLAY_MODES[number];

export const QUALITY_MODES = ['performance', 'balanced', 'ultra'] as const;
export type QualityMode = typeof QUALITY_MODES[number];

// ─── Core domain types ───────────────────────────────────────────────────────

export type SkyState = 'day' | 'night' | 'dawn' | 'dusk';

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
	/** Populated by WindowModel so engines can read CameraConfig without importing it. */
	camera: CameraConfig;
	/** Populated by WindowModel so engines can read DirectorConfig without importing it. */
	director: DirectorConfig;
	/** DirectorEngine-specific (populated only for director.tick) */
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
