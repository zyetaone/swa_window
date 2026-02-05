/**
 * Application Constants
 *
 * Centralized magic numbers and configuration values
 * to improve maintainability and clarity.
 */

import type { WeatherType } from './types';

// =============================================================================
// AIRCRAFT SYSTEMS
// =============================================================================

export const AIRCRAFT = {
	// Lightning timing (seconds)
	LIGHTNING_MIN_INTERVAL: 5,
	LIGHTNING_MAX_INTERVAL: 30,
	LIGHTNING_DECAY_RATE: 8,

	// Flight drift (degrees per second at speed=1.0)
	DRIFT_RATE: 0.006,

	// Orbit path shape (elongated ellipse for sustained forward flight feel)
	ORBIT_MAJOR: 2.0,    // degrees (~220km) — long axis (extended straight legs)
	ORBIT_MINOR: 0.06,   // degrees (~7km)  — short axis (tight turns, zipped through quickly)

	// Turbulence base multipliers
	TURBULENCE_MULTIPLIERS: {
		severe: 3,
		moderate: 1.5,
		light: 1,
	} as const,

	// Altitude bounds (feet)
	MIN_ALTITUDE: 10000,
	MAX_ALTITUDE: 65000,

	// Frost thresholds (feet)
	FROST_START_ALTITUDE: 25000,
	FROST_MAX_ALTITUDE: 40000,

	// Motion effect scalars
	TURBULENCE_OFFSET_Y: 0.05,

	// Time of day bounds
	MIN_TIME: 0,
	MAX_TIME: 24,
	REAL_TIME_SYNC_INTERVAL: 60000, // 1 minute

} as const;

// =============================================================================
// FLIGHT FEEL (modular motion layers)
// =============================================================================

export const FLIGHT_FEEL = {
	// Banking — horizon tilt during orbit turns
	BANK_ANGLE_MAX: 6.0,       // degrees max bank (visible tilt during turns)
	BANK_SMOOTHING: 2.5,       // lerp speed (smooth roll in/out)

	// Pitch breathing — slow nose-up/down oscillation
	BREATHING_PERIOD: 22,      // seconds for one full cycle
	BREATHING_AMPLITUDE: 1.5,  // pixels of Y translation

	// Engine micro-vibration — constant fine hum (below 30Hz Nyquist)
	ENGINE_VIBE_FREQ_X: 7,     // Hz (lowered for visible movement at 60fps)
	ENGINE_VIBE_FREQ_Y: 11,    // Hz (different to avoid Lissajous lock)
	ENGINE_VIBE_AMP: 0.35,     // pixels amplitude (perceptible tremor)

	// Turbulence bumps — occasional jolts simulating air pockets
	BUMP_MIN_INTERVAL: 30,   // seconds between bumps (minimum)
	BUMP_MAX_INTERVAL: 120,  // seconds between bumps (maximum)
	BUMP_DECAY: 8,           // exponential decay rate
	BUMP_RING_FREQ: 15,      // damped oscillation frequency
	BUMP_AMPLITUDE: 3,       // pixels peak displacement
} as const;

// =============================================================================
// MICRO-EVENTS (moments of surprise for attentive viewers)
// =============================================================================

export const MICRO_EVENTS = {
	// Timing (seconds)
	MIN_INTERVAL: 1200,      // minimum 20 minutes between events
	MAX_INTERVAL: 2400,      // maximum 40 minutes between events
	INITIAL_DELAY: 300,      // first event after 5 minutes

	// Duration (seconds)
	SHOOTING_STAR_DURATION: 1.5,
	BIRD_DURATION: 8,
	CONTRAIL_DURATION: 12,
} as const;

// =============================================================================
// AMBIENT RANDOMIZATION
// =============================================================================

export const AMBIENT = {
	// Timer intervals (seconds)
	INITIAL_MIN_DELAY: 120,   // first change after 2 minutes
	INITIAL_MAX_DELAY: 300,   // first change before 5 minutes
	SUBSEQUENT_MIN_DELAY: 180, // subsequent changes after 3 minutes
	SUBSEQUENT_MAX_DELAY: 480, // subsequent changes before 8 minutes

	// Drift ranges per cycle
	CLOUD_DENSITY_SHIFT: 0.3,
	CLOUD_DENSITY_MIN: 0.2,
	CLOUD_DENSITY_MAX: 1.0,
	CLOUD_SPEED_SHIFT: 0.4,
	CLOUD_SPEED_MIN: 0.2,
	CLOUD_SPEED_MAX: 1.5,
	HAZE_SHIFT: 0.04,
	HAZE_MIN: 0,
	HAZE_MAX: 0.15,

	// Probability of weather transition per cycle
	WEATHER_CHANGE_CHANCE: 0.2,
} as const;

// =============================================================================
// CESIUM LAYER THRESHOLDS & TUNING
// =============================================================================

export const CESIUM = {
	// Road light layer (CartoDB Dark basemap, real OSM roads)
	ROAD_LIGHT_NIGHT_ALPHA: 0.55,
	ROAD_LIGHT_NIGHT_BRIGHTNESS: 3.5,
	ROAD_LIGHT_CONTRAST: 1.6,
	ROAD_LIGHT_SATURATION: 1.4,

	// Selective night bloom (tuned to only bloom bright pixels = city lights)
	BLOOM_NIGHT_CONTRAST: 180,
	BLOOM_BRIGHTNESS: -0.3,
	BLOOM_SIGMA: 4.0,
	BLOOM_DELTA: 1.5,
	BLOOM_STEP_SIZE: 2.0,
} as const;

// =============================================================================
// WEATHER EFFECTS
// =============================================================================

export interface WeatherEffect {
	turbulence: 'light' | 'moderate' | 'severe';
	hasLightning: boolean;
	cloudDensityRange: [min: number, max: number];
	nightCloudFloor: number;
	rainOpacity: number;
	windAngle: number;
	filterBrightness: number;
}

export const WEATHER_EFFECTS: Record<WeatherType, WeatherEffect> = {
	clear: {
		turbulence: 'light',
		hasLightning: false,
		cloudDensityRange: [0, 0.3],
		nightCloudFloor: 0,
		rainOpacity: 0,
		windAngle: 88,
		filterBrightness: 1.0,
	},
	cloudy: {
		turbulence: 'light',
		hasLightning: false,
		cloudDensityRange: [0.4, 1],
		nightCloudFloor: 0,
		rainOpacity: 0,
		windAngle: 87,
		filterBrightness: 1.0,
	},
	rain: {
		turbulence: 'moderate',
		hasLightning: false,
		cloudDensityRange: [0.5, 0.9],
		nightCloudFloor: 0.3,
		rainOpacity: 0.25,
		windAngle: 86,
		filterBrightness: 0.95,
	},
	overcast: {
		turbulence: 'moderate',
		hasLightning: false,
		cloudDensityRange: [0.7, 1],
		nightCloudFloor: 0.5,
		rainOpacity: 0.18,
		windAngle: 86,
		filterBrightness: 0.95,
	},
	storm: {
		turbulence: 'severe',
		hasLightning: true,
		cloudDensityRange: [0.85, 1],
		nightCloudFloor: 0.65,
		rainOpacity: 0.35,
		windAngle: 84,
		filterBrightness: 0.9,
	},
};
