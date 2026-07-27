/**
 * Domain types — single source of truth.
 *
 * Runtime-validated unions (WeatherType, DisplayMode, QualityMode,
 * DeviceRole) are derived from `as const` arrays so the type and the
 * validator stay in lock-step. Other types are pure domain shapes.
 *
 * `Location` / `SceneDefaults` live in `$content/locations` (Rule 0).
 * `CameraConfig` / `DirectorConfig` are derived from the live config
 * tree at `$lib/model/config-tree.svelte`.
 */

import type { LocationId } from '$content/locations';
export type { LocationId } from '$content/locations';
import type { CameraConfig, DirectorConfig } from './model/config-tree.svelte';

// ─── Const-array-derived unions (runtime + compile-time SSOT) ────────────────

export const WEATHER_TYPES = ['clear', 'cloudy', 'rain', 'overcast', 'storm'] as const;
export type WeatherType = typeof WEATHER_TYPES[number];
export function isValidWeather(v: unknown): v is WeatherType { return validateConst(WEATHER_TYPES, v); }

export const DISPLAY_MODES = ['flight', 'screensaver', 'video'] as const;
export type DisplayMode = typeof DISPLAY_MODES[number];
export function isValidDisplayMode(v: unknown): v is DisplayMode { return validateConst(DISPLAY_MODES, v); }

export const QUALITY_MODES = ['performance', 'balanced', 'ultra'] as const;
export type QualityMode = typeof QUALITY_MODES[number];
export function isValidQualityMode(v: unknown): v is QualityMode { return validateConst(QUALITY_MODES, v); }

export const DEVICE_ROLES = ['left', 'center', 'right', 'solo'] as const;
export type DeviceRole = typeof DEVICE_ROLES[number];
export function isValidDeviceRole(v: unknown): v is DeviceRole { return validateConst(DEVICE_ROLES, v); }

/** Generic const-array validator — shared by all isValid* type guards. */
function validateConst<T extends string>(arr: readonly T[], v: unknown): v is T {
	return typeof v === 'string' && (arr as readonly string[]).includes(v);
}

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
	warpFactor: number;
	turbulenceLevel: 'light' | 'moderate' | 'severe';
	/** Populated by AeroWindow so engines can read CameraConfig without importing it. */
	camera: CameraConfig;
	/** Populated by AeroWindow so engines can read DirectorConfig without importing it. */
	director: DirectorConfig;
	/** DirectorEngine-specific (populated only for director.tick) */
	isOrbitMode?: boolean;
	pickNextLocation?: () => LocationId;
	/** Phase 7 — true when this device should run autopilot decisions.
	 *  Solo and center roles are leaders; left/right are followers that
	 *  receive director_decision messages over the fleet. */
	isLeader?: boolean;
}

// ─── Engine patch types ──────────────────────────────────────────────────────

export type FlightMode = 'orbit' | 'cruise_departure' | 'cruise_transit' | 'arrival_hold';

export interface FlightPatch {
	blindOpen?: boolean;
	locationArrived?: LocationId;
	resetDirector?: boolean;
}

/**
 * A "night-city flyover" vantage beat — the director occasionally pitches the
 * camera DOWN over the lit city for a while, then returns to orbit. Decided by
 * the leader and broadcast (a `vantage_beat` fleet command carries the same
 * fields + a shared `transitionAtMs`) so all 3 Pis enter/exit in lock-step.
 */
export interface VantageBeat {
	/** How long the flyover holds before auto-returning to orbit, in ms. */
	durationMs: number;
	/** Camera look-down pitch while active, in degrees (e.g. -60). */
	pitchDeg: number;
	/** Altitude to descend to for the beat, in feet. */
	altitudeFt: number;
}

export interface WorldPatch {
	/** Path-targeted config patches from the director (clouds, haze, weather). */
	configs?: Array<{ path: string; value: unknown }>;
	nextLocation?: LocationId | null;
	/** Set when the director chooses to enter a night-city flyover this frame. */
	vantageBeat?: VantageBeat;
}

export interface MicroEventData {
	type: 'shooting-star' | 'bird' | 'contrail';
	elapsed: number;
	duration: number;
	x: number;
	y: number;
}

// ─── Scenario types ──────────────────────────────────────────────────────────

interface Waypoint {
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
