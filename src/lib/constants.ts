/**
 * Application Constants — SSOT.
 *
 * Centralized magic numbers and configuration values for aircraft
 * physics, flight feel, micro-events, ambient randomization, Cesium
 * tuning, and weather effects.
 */

import type { WeatherType, QualityMode } from './types';

// =============================================================================
// AIRCRAFT SYSTEMS
// =============================================================================

export const AIRCRAFT = {
	// Lightning timing (seconds)
	LIGHTNING_MIN_INTERVAL: 5,
	LIGHTNING_MAX_INTERVAL: 30,
	LIGHTNING_DECAY_RATE: 8,

	// Flight drift (degrees per second at speed=1.0)
	// Bumped from 0.006 → 0.01 so orbit motion reads as commercial-cruise
	// pace rather than barely drifting. At speed=1.4 default this gives
	// ~2.3× the previous apparent forward motion across the viewport.
	DRIFT_RATE: 0.01,

	// Orbit path shape (fallback ellipse when no waypoint scenario exists)
	ORBIT_MAJOR: 0.15, // degrees (~17km) — long axis
	ORBIT_MINOR: 0.06, // degrees (~7km) — short axis (~2.5:1 aspect — gentle banking turns)

	// Dynamic orbit breathing range (orbit dimensions slowly oscillate within these bounds)
	ORBIT_MAJOR_MIN: 0.08, // tightest orbit (dense city passes)
	ORBIT_MAJOR_MAX: 0.25, // widest orbit (sweeping vista passes)
	ORBIT_BREATHE_PERIOD: 180, // seconds per full breathe cycle

	// Turbulence base multipliers
	TURBULENCE_MULTIPLIERS: {
		severe: 3,
		moderate: 1.5,
		light: 1,
	} as const,

	// Altitude bounds (feet)
	DEFAULT_ALTITUDE: 35000 as const,
	MIN_ALTITUDE: 10000 as const,
	MAX_ALTITUDE: 65000 as const,

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
	BANK_ANGLE_MAX: 6.0, // degrees max bank (visible tilt during turns)
	BANK_SMOOTHING: 2.5, // lerp speed (smooth roll in/out)

	// Pitch breathing — slow nose-up/down oscillation
	BREATHING_PERIOD: 22, // seconds for one full cycle
	BREATHING_AMPLITUDE: 1.5, // pixels of Y translation

	// Engine micro-vibration — constant fine hum (below 30Hz Nyquist)
	ENGINE_VIBE_FREQ_X: 7, // Hz (lowered for visible movement at 60fps)
	ENGINE_VIBE_FREQ_Y: 11, // Hz (different to avoid Lissajous lock)
	ENGINE_VIBE_AMP: 0.35, // pixels amplitude (perceptible tremor)

	// Turbulence bumps — occasional jolts simulating air pockets
	BUMP_MIN_INTERVAL: 30, // seconds between bumps (minimum)
	BUMP_MAX_INTERVAL: 120, // seconds between bumps (maximum)
	BUMP_DECAY: 8, // exponential decay rate
	BUMP_RING_FREQ: 15, // damped oscillation frequency
	BUMP_AMPLITUDE: 3, // pixels peak displacement
} as const;

// =============================================================================
// MICRO-EVENTS (moments of surprise for attentive viewers)
// =============================================================================

export const MICRO_EVENTS = {
	// Timing (seconds)
	MIN_INTERVAL: 100,
	MAX_INTERVAL: 300,

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
	INITIAL_MIN_DELAY: 120, // first change after 2 minutes
	INITIAL_MAX_DELAY: 300, // first change before 5 minutes
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
	// Weighted pool for auto-cycle (storm excluded, cloudy doubled for probability)
	WEATHER_POOL: ['clear', 'cloudy', 'cloudy', 'rain', 'overcast'] as const,

	// Director auto-pilot cycling (seconds)
	DIRECTOR_MIN_INTERVAL: 120,
	DIRECTOR_MAX_INTERVAL: 300,
} as const;

// =============================================================================
// CESIUM LAYER THRESHOLDS & TUNING
// =============================================================================

export interface CesiumQualityPreset {
	maximumScreenSpaceError: number;
	tileCacheSize: number;
	preloadSiblings: boolean;
	preloadAncestors: boolean;
	loadingDescendantLimit: number;
}

export const CESIUM_QUALITY_PRESETS: Record<QualityMode, CesiumQualityPreset> = {
	performance: {
		maximumScreenSpaceError: 8,    // Bigger tiles, fewer LOD changes (low-end Pi)
		tileCacheSize: 50,             // Was 20 — keep more loaded to avoid reload churn
		preloadSiblings: false,
		preloadAncestors: true,
		loadingDescendantLimit: 4,
	},
	balanced: {
		// MSSE 4 = aggressive subdivision → many small tiles → adjacent tiles end up at
		// different LODs producing visible seams at perspective angles. Slight bump to 5
		// keeps detail high but reduces per-tile LOD divergence.
		maximumScreenSpaceError: 5,
		tileCacheSize: 100,            // Was 50 — keep more in memory, stop reload churn
		// Was false. Without sibling preload, each tile flips its LOD independently as the
		// camera moves, leaving visible boundary lines. Preloading neighbors eliminates this.
		preloadSiblings: true,
		preloadAncestors: true,
		loadingDescendantLimit: 6,     // Was 4 — slightly more aggressive subdivision when needed
	},
	ultra: {
		maximumScreenSpaceError: 2,    // High detail — sharper edges
		tileCacheSize: 200,            // Was 100 — generous for desktop dev
		preloadSiblings: true,
		preloadAncestors: true,
		loadingDescendantLimit: 8,     // Was 6
	},
};

export const CESIUM = {
	// Base imagery dim at full night — EOX/Mapbox/ESRI day imagery multiplied
	// by these factors when nightFactor=1. Keeps night actually dark so the
	// shader's lightMask doesn't misread faint terrain as city lights.
	BASE_NIGHT_BRIGHTNESS: 0.15, // 15% of day brightness (nearly black terrain)
	BASE_NIGHT_SATURATION: 0.25, // mostly desaturated — avoids vivid leakage

	// Night city glow overlay — CartoDB Dark basemap composited over the
	// dimmed base at nightFactor=1. The tile's dark background locks in the
	// dark night; its lit road grid punches through to carry city light.
	// Brightness lowered from 2.5 → 1.6 so roads don't blow to pure white
	// (which was fueling the shader's amber amplification).
	NIGHT_ALPHA: 0.8,
	NIGHT_BRIGHTNESS: 1.6,
	NIGHT_CONTRAST: 1.6,

	// Bloom post-process stage — enabled at balanced/ultra quality so bright
	// city-light fragments bleed into soft halos that merge between adjacent
	// intersections. High contrast + negative brightness means only the top
	// of the luminance range blooms (bright roads, not dim terrain). Sigma
	// controls the Gaussian spread — the "inkling" quality.
	BLOOM_CONTRAST: 128,
	BLOOM_BRIGHTNESS: -0.3,
	BLOOM_SIGMA: 3.5,
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
		cloudDensityRange: [0.7, 1],
		nightCloudFloor: 0,
		rainOpacity: 0,
		windAngle: 87,
		filterBrightness: 1.0,
	},
	rain: {
		turbulence: 'moderate',
		hasLightning: false,
		cloudDensityRange: [0.8, 1],
		nightCloudFloor: 0.3,
		rainOpacity: 0.25,
		windAngle: 86,
		filterBrightness: 0.95,
	},
	overcast: {
		turbulence: 'moderate',
		hasLightning: false,
		cloudDensityRange: [0.92, 1],
		nightCloudFloor: 0.5,
		rainOpacity: 0.18,
		windAngle: 86,
		filterBrightness: 0.9,
	},
	storm: {
		turbulence: 'severe',
		hasLightning: true,
		cloudDensityRange: [0.98, 1],
		nightCloudFloor: 0.7,
		rainOpacity: 0.35,
		windAngle: 84,
		filterBrightness: 0.85,
	},
};
