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

// =============================================================================
// COLORS - Time of day lighting colors (RGB 0-1)
// =============================================================================

export const SUN_COLORS_RGB = {
	night: { r: 0.2, g: 0.25, b: 0.4 },
	dawn: { r: 1.0, g: 0.7, b: 0.5 },
	dusk: { r: 1.0, g: 0.5, b: 0.3 },
	day: { r: 1.0, g: 0.98, b: 0.95 },
} as const;

export const CLOUD_COLORS_RGB = {
	night: { r: 0.25, g: 0.28, b: 0.35 },
	dawn: { r: 1.0, g: 0.85, b: 0.75 },
	dusk: { r: 1.0, g: 0.75, b: 0.65 },
	day: { r: 1.0, g: 1.0, b: 1.0 },
} as const;

export type SkyStateKey = keyof typeof SUN_COLORS_RGB;

// =============================================================================
// AIRCRAFT SYSTEMS
// =============================================================================

export const AIRCRAFT = {
	// Strobe light timing (seconds)
	STROBE_INTERVAL: 1.5,
	STROBE_DURATION: 0.1,

	// Lightning timing (seconds)
	LIGHTNING_MIN_INTERVAL: 5,
	LIGHTNING_MAX_INTERVAL: 30,
	LIGHTNING_DECAY_RATE: 8,

	// Flight drift (degrees per second at speed=1.0)
	DRIFT_RATE: 0.006,

	// Bank angle adjustments (degrees)
	BANK_THRESHOLD: 0.95,
	BANK_AMOUNT: 0.1,

	// Turbulence frequencies (Hz - affects natural movement feel)
	WANDER_SLOW: 0.03,
	WANDER_MEDIUM: 0.11,
	WANDER_FAST: 0.37,
	BANK_TRIGGER_FREQ: 0.02,

	// Vibration frequencies (Hz)
	VIBRATION_FREQ_1: 60,
	VIBRATION_FREQ_2: 47,

	// Turbulence base multipliers
	TURBULENCE_MULTIPLIERS: {
		severe: 3,
		moderate: 1.5,
		light: 1,
	} as const,

	// Flight speed multipliers
	MIN_SPEED: 0.2,
	MAX_SPEED: 5.0,
	DEFAULT_SPEED: 1.0,

	// Altitude bounds (feet)
	MIN_ALTITUDE: 10000,
	MAX_ALTITUDE: 65000,

	// Heading wander range (degrees)
	WANDER_RANGE_SLOW: 0.02,
	WANDER_RANGE_MEDIUM: 0.01,
	WANDER_RANGE_FAST: 0.005,

	// Motion effect scalars
	TURBULENCE_OFFSET_X: 0.1,
	TURBULENCE_OFFSET_Y: 0.05,
	TURBULENCE_OFFSET_Z: 0.1,

	// Rotation scalars (radians)
	MOTION_PITCH_SCALE: 0.005,
	MOTION_ROLL_SCALE: 0.008,
	MOTION_YAW_SCALE: 0.003,

	// Transition animation
	TRANSITION_BLIND_DELAY: 500,
	TRANSITION_ASCEND_DURATION: 2000,
	TRANSITION_CRUISE_DURATION: 1000,
	TRANSITION_DESCEND_DURATION: 2000,
	TRANSITION_TARGET_ALTITUDE: 38000,

	// Time of day bounds
	MIN_TIME: 0,
	MAX_TIME: 24,
	REAL_TIME_SYNC_INTERVAL: 60000, // 1 minute

} as const;

// =============================================================================
// WINDOW BLIND
// =============================================================================

export const BLIND = {
	// Frost opacity calculation
	FROST_START_ALTITUDE: 25000,
	FROST_MAX_ALTITUDE: 40000,

	// Auto-cycle timing
	AUTO_CYCLE_INTERVAL: 25 * 60 * 1000, // 25 minutes

} as const;
