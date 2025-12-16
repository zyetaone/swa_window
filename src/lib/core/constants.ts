/**
 * Application Constants
 *
 * Centralized magic numbers and configuration values
 * to improve maintainability and clarity.
 */

// =============================================================================
// UNIT CONVERSIONS
// =============================================================================

export const UNITS = {
	FEET_TO_METERS: 0.3048,
	METERS_TO_FEET: 3.28084,
} as const;

// =============================================================================
// ATMOSPHERIC EFFECTS
// =============================================================================

export const ATMOSPHERE = {
	// Frost appears above this altitude (feet)
	FROST_START_ALTITUDE: 25000,
	FROST_FULL_ALTITUDE: 40000,

	// Contrails appear above this altitude (feet)
	CONTRAIL_MIN_ALTITUDE: 28000,

	// Fog density calculation base
	FOG_DENSITY_BASE: 0.00015,
	FOG_MIN_BRIGHTNESS: 0.1,

	// Visibility bounds (km)
	MIN_VISIBILITY: 5,
	MAX_VISIBILITY: 100
} as const;

// =============================================================================
// PERFORMANCE
// =============================================================================

export const PERFORMANCE = {
	// Cloud material cloning threshold
	MAX_CLOUD_INSTANCES: 300,

	// Contrail particle limits
	MAX_CONTRAIL_PARTICLES: 100,
	CONTRAIL_LIFETIME: 3, // seconds

	// Animation frame budget (ms)
	TARGET_FRAME_TIME: 16.67 // 60 FPS
} as const;
