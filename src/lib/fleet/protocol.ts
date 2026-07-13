/**
 * Fleet type surface — types shared by device browser (SSE client) and
 * admin browser (REST client). Post-WS cleanup: the v1/v2 wire-message
 * unions, hub ServerMessage discriminants, and isV2() guard are gone —
 * there's no wire format to negotiate anymore. REST endpoints speak plain
 * JSON shapes that live next to their handlers in routes/api/*.
 *
 * What stays:
 *   FleetClientModel — narrow interface the device's SSE client needs
 *                      from AeroWindow.
 *   DisplayConfig    — flat admin-pushable override DTO (legacy v1).
 *   DeviceInfo       — admin-side row shape for the device table.
 */

import type { LocationId, WeatherType, DisplayMode, QualityMode, VantageBeat } from '$lib/types';
import type { Telemetry } from '$lib/model/frame-telemetry.svelte';

export interface FleetClientModel {
	measuredFps: number;
	displayMode: DisplayMode;
	location: LocationId;
	weather: WeatherType;
	qualityMode: QualityMode;
	syncToRealTime: boolean;
	/** Navigate to a location, optionally setting weather. */
	applyScene(location: LocationId, weather?: WeatherType): void;
	/** Schedule a night-city flyover beat locked to a shared transitionAtMs.
	 *  Optional so test stubs and older models stay valid; the client feature-tests. */
	scheduleFlyover?(beat: VantageBeat, transitionAtMs: number): void;
	setDisplayMode(mode: DisplayMode, payload?: string): void;
	setQualityMode(mode: QualityMode): void;
	setAltitude(alt: number): void;
	setTime(t: number): void;
	setFlightSpeed(n: number): void;
	/**
	 * Path-targeted patch — applied through RootConfig.applyConfigPatch.
	 * Returns true if the path was recognised. Optional so test stubs and
	 * older models remain valid; the SSE client feature-tests.
	 */
	applyConfigPatch?(path: string, value: unknown): boolean;
	/** Observability sink — optional. */
	telemetry?: Telemetry;
}

/** Flat admin-pushable config DTO (legacy v1). Decomposed into typed setter calls in the fleet client. */
export interface DisplayConfig {
	altitude?: number;
	timeOfDay?: number;
	weather?: WeatherType;
	cloudDensity?: number;
	flightSpeed?: number;
	syncToRealTime?: boolean;
	showClouds?: boolean;
	nightLightIntensity?: number;
	qualityMode?: QualityMode;
}

export interface DeviceInfo {
	deviceId: string;
	hostname: string;
	currentMode: DisplayMode;
	currentLocation: LocationId;
	fps: number;
	uptime: number;
	lastSeen: number;
	online: boolean;
}

export interface DeviceStatus {
	deviceId: string;
	hostname: string;
	fps: number;
	mode: DisplayMode;
	location: LocationId;
	weather: WeatherType;
	uptime: number;
	lastSeen: number;
}

/** Returned by GET /api/fleet/heartbeat?summary — rollup across the fleet. */
export interface FleetSummary {
	total: number;
	online: number;
	offline: number;
	avgFps: number;
	maxTempC: number;
	totalCrashes: number;
}
