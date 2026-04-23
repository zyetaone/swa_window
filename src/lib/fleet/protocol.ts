/**
 * Fleet type surface — types shared by device browser (SSE client) and
 * admin browser (REST client). Post-WS cleanup: the v1/v2 wire-message
 * unions, hub ServerMessage discriminants, and isV2() guard are gone —
 * there's no wire format to negotiate anymore. REST endpoints speak plain
 * JSON shapes that live next to their handlers in routes/api/*.
 *
 * What stays:
 *   FleetClientModel — narrow interface the device's SSE client needs
 *                      from AeroWindow (applyPatch DTO adapter, etc.).
 *   DisplayConfig    — flat admin-pushable override DTO. Still used by
 *                      admin panel UI + device applyPatch adapter.
 *   DeviceCaps       — browser-reported capabilities (used in rest-admin
 *                      typing, though we no longer send it as a register
 *                      message — device /api/status could expose a subset
 *                      if an admin UI needs it).
 *   DeviceInfo       — admin-side row shape for the device table.
 */

import type { LocationId, WeatherType, DisplayMode, QualityMode } from '$lib/types';
import type { Telemetry } from '$lib/model/frame-telemetry.svelte';

export interface FleetClientModel {
	measuredFps: number;
	displayMode: DisplayMode;
	location: LocationId;
	weather: WeatherType;
	qualityMode: QualityMode;
	/** Navigate to a location, optionally setting weather. */
	applyScene(location: LocationId, weather?: WeatherType): void;
	setDisplayMode(mode: DisplayMode, payload?: string): void;
	setQualityMode(mode: QualityMode): void;
	applyPatch(patch: Partial<DisplayConfig>): void;
	/**
	 * Path-targeted patch — applied through RootConfig.applyPatch.
	 * Returns true if the path was recognised. Optional so test stubs and
	 * older models remain valid; the SSE client feature-tests.
	 */
	applyConfigPatch?(path: string, value: unknown): boolean;
	/** Observability sink — optional. */
	telemetry?: Telemetry;
}

export interface DeviceCaps {
	webglVersion: number;
	supportsHDR: boolean;
	screenWidth: number;
	screenHeight: number;
	gpuRenderer: string;
	userAgent: string;
}

/** Flat admin-pushable config DTO. Applied on the device via model.applyPatch. */
export interface DisplayConfig {
	altitude?: number;
	timeOfDay?: number;
	heading?: number;
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
	capabilities: DeviceCaps;
	currentMode: DisplayMode;
	currentLocation: LocationId;
	fps: number;
	uptime: number;
	lastSeen: number;
	online: boolean;
}
