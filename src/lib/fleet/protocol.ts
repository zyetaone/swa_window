/**
 * WebSocket Protocol — Admin ↔ Server ↔ Display communication.
 *
 * All messages are JSON-serialized. The server acts as a hub:
 * - Admin sends commands → server routes to target display(s)
 * - Displays send status → server aggregates for admin
 */

import type { LocationId, WeatherType, DisplayMode, QualityMode } from '$lib/types';
import type { DeviceRole } from '$lib/model/config.svelte';
import type { Telemetry } from '$lib/model/telemetry.svelte';

// ============================================================================
// FLEET CLIENT MODEL (narrow interface for display WS client)
// ============================================================================

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
	 * v2 path-targeted patch — applied through RootConfig.applyPatch.
	 * Returns true if the path was recognised. Optional on legacy models
	 * that haven't yet adopted v2; the fleet client feature-tests.
	 */
	applyConfigPatch?(path: string, value: unknown): boolean;
	/**
	 * Observability sink — optional so test stubs and older models remain
	 * valid. The fleet client feature-tests with `?.` before recording.
	 */
	telemetry?: Telemetry;
}

// ============================================================================
// DEVICE CAPABILITIES (sent on registration)
// ============================================================================

export interface DeviceCaps {
	/** WebGL version supported (1 or 2) */
	webglVersion: number;
	/** Whether EXT_color_buffer_float is available (HDR support) */
	supportsHDR: boolean;
	/** Screen resolution */
	screenWidth: number;
	screenHeight: number;
	/** GPU renderer string */
	gpuRenderer: string;
	/** User agent */
	userAgent: string;
}

// ============================================================================
// DISPLAY CONFIG (pushable overrides)
// ============================================================================

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
	/** Cesium terrain LOD preset: performance / balanced / ultra */
	qualityMode?: QualityMode;
}

// ============================================================================
// DEVICE INFO (server-side registry)
// ============================================================================

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

// ============================================================================
// SERVER → DISPLAY MESSAGES
// ============================================================================

export type ServerMessage =
	| { type: 'set_mode'; mode: DisplayMode; payload?: string }
	| { type: 'set_scene'; location: LocationId; weather?: WeatherType }
	| { type: 'set_config'; patch: DisplayConfig }
	| { type: 'tile_update'; locationId: LocationId; version: string; url: string }
	| { type: 'ping' }
	| { type: 'set_quality'; mode: QualityMode };

// ============================================================================
// DISPLAY → SERVER MESSAGES
// ============================================================================

export type DisplayMessage =
	| { type: 'register'; deviceId: string; hostname: string; capabilities: DeviceCaps }
	| { type: 'status'; fps: number; mode: DisplayMode; location: string; uptime: number }
	| { type: 'tile_status'; cachedLocations: LocationId[]; diskUsageBytes: number }
	| { type: 'pong' };

// ============================================================================
// SERVER → ADMIN MESSAGES (push events over WebSocket)
// ============================================================================

export type ServerAdminMessage =
	| { type: 'device_registered'; device: DeviceInfo }
	| {
			type: 'device_status';
			deviceId: string;
			fps: number;
			mode: DisplayMode;
			location: string;
			uptime: number;
	  }
	| { type: 'device_offline'; deviceId: string };

// ============================================================================
// PROTOCOL v2 — ADDITIVE (Phase 6)
// ============================================================================
//
// v2 is strictly additive. v1 messages remain valid and a mixed fleet of v1
// and v2 devices/servers keeps working. Every v2 message has an explicit
// `v: 2` discriminator so the router can dispatch without ambiguity.
//
// Why v2 exists:
//   - v1 patches are flat (`{ patch: { altitude, weather, ... } }`). Phase 1
//     introduced the nested RootConfig tree; admin push against
//     `config.atmosphere.clouds.density` doesn't fit a flat patch.
//   - Phase 7 (multi-Pi parallax) needs per-device role assignment +
//     coordinated scenario changes (`director_decision`) — wholly new
//     message shapes.
//
// Migration plan:
//   Phase A: devices learn to receive v2 (this commit). Server still only
//            sends v1.
//   Phase B: server learns to send v2 when device advertises protocols: [1,2].
//   Phase C: deprecate v1 send path. v1 receive path stays indefinitely for
//            older admin tools.

/** Which config layer a patch targets (the first path segment). */
export type ConfigLayer = 'world' | 'atmosphere' | 'camera' | 'director' | 'shell';

/** Server → Display, v2. Path-targeted + parallax-aware. */
export type ServerMessageV2 =
	/**
	 * Path-keyed mutation of a RootConfig field. Dispatched through
	 * WindowModel.config.applyPatch(path, value). Paths look like
	 * 'atmosphere.clouds.density' or 'shell.windowFrame'.
	 */
	| { v: 2; type: 'config_patch'; path: string; value: unknown }
	/**
	 * Bulk replace one layer's config (e.g. admin loads a named preset).
	 * Internally calls every leaf setPath on that layer.
	 */
	| { v: 2; type: 'config_replace'; layer: ConfigLayer; snapshot: Record<string, unknown> }
	/**
	 * Multi-Pi parallax role assignment. Device uses this to pick its
	 * per-frame yaw offset. Sent to a specific deviceId, not broadcast.
	 */
	| {
			v: 2;
			type: 'role_assign';
			deviceId: string;
			role: DeviceRole;
			headingOffsetDeg?: number;
			fovDeg?: number;
			/** Panorama group ID so multiple triptychs can coexist. */
			groupId?: string;
	  }
	/**
	 * Leader-elected scenario decision, broadcast to all followers in a
	 * group. Followers schedule their own FSM transition to `transitionAtMs`
	 * (wall-clock) so all three Pis flip simultaneously even with NTP drift.
	 */
	| {
			v: 2;
			type: 'director_decision';
			scenarioId: string;
			locationId: LocationId;
			weather?: WeatherType;
			decidedAtMs: number;
			transitionAtMs: number;
			groupId?: string;
	  };

/** Display → Server, v2. Adds capability advertisement + snapshot reply. */
export type DisplayMessageV2 =
	| {
			v: 2;
			type: 'capabilities';
			deviceId: string;
			hostname: string;
			capabilities: DeviceCaps;
			/** Advertised protocol versions this device can receive. */
			protocols: readonly number[];
			/** Optional pre-declared role (e.g. from URL ?role=left). */
			role?: DeviceRole;
	  }
	/** On-demand full config snapshot, e.g. for admin debugging. */
	| {
			v: 2;
			type: 'config_snapshot';
			configs: {
				world: Record<string, unknown>;
				atmosphere: Record<string, unknown>;
				camera: Record<string, unknown>;
				director: Record<string, unknown>;
				shell: Record<string, unknown>;
			};
	  };

/**
 * Helper — is this a v2 message?
 *
 * Both senders and receivers discriminate by the presence of `v === 2`.
 * v1 messages never carry a `v` field, so the check is unambiguous.
 */
export function isV2(msg: unknown): msg is { v: 2; type: string } {
	return typeof msg === 'object' && msg !== null && (msg as { v?: unknown }).v === 2;
}
