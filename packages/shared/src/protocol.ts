/**
 * WebSocket Protocol — Admin ↔ Server ↔ Display communication
 *
 * All messages are JSON-serialized. The server acts as a hub:
 * - Admin sends commands → server routes to target display(s)
 * - Displays send status → server aggregates for admin
 */

import type { LocationId, WeatherType } from './types';

// ============================================================================
// DISPLAY MODES
// ============================================================================

export type DisplayMode = 'flight' | 'screensaver' | 'video';

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
	| { type: 'ping' };

// ============================================================================
// DISPLAY → SERVER MESSAGES
// ============================================================================

export type DisplayMessage =
	| { type: 'register'; deviceId: string; hostname: string; capabilities: DeviceCaps }
	| { type: 'status'; fps: number; mode: DisplayMode; location: string; uptime: number }
	| { type: 'pong' };
