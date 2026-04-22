/**
 * camera-config.ts — Simulation tuning for cameras and directors.
 */
import type { CameraConfig, DirectorConfig } from '$lib/types';

export const simulationCameraConfig: CameraConfig = {
	orbit: {
		driftRate: 0.15,
		major: 0.015,
		minor: 0.008,
		majorMin: 0.01,
		majorMax: 0.02,
		breathePeriod: 60,
	},
	cruise: {
		departureDurationSec: 2.0,
		transitDurationSec: 2.0,
		defaultSpeed: 1.0,
		minSpeed: 0.1,
		maxSpeed: 3.0,
	},
	motion: {
		bankAngleMax: 6.0,
		bankSmoothing: 2.5,
		breathingPeriod: 22,
		breathingAmplitude: 1.5,
		engineVibeFreqX: 7,
		engineVibeFreqY: 11,
		engineVibeAmp: 0.35,
		bumpMinInterval: 30,
		bumpMaxInterval: 120,
		bumpDecay: 8,
		bumpRingFreq: 15,
		bumpAmplitude: 3,
		turbulenceMultipliers: { severe: 3, moderate: 1.5, light: 1 },
		turbulenceOffsetY: 0.05,
	},
	altitude: {
		default: 30000,
		min: 5000,
		max: 45000,
	},
	parallax: {
		role: 'solo',
		headingOffsetDeg: 0,
		fovDeg: 60,
		panoramaArcDeg: 44,
	},
	effectiveHeading(baseHeading: number): number {
		return baseHeading;
	},
};

export const simulationDirectorConfig: DirectorConfig = {
	daylight: { syncToRealTime: false, manualTimeOfDay: 12, syncIntervalMs: 60000 },
	autopilot: {
		enabled: false,
		initialMinDelay: 60,
		initialMaxDelay: 120,
		subsequentMinDelay: 60,
		subsequentMaxDelay: 180,
		weatherChangeChance: 0,
		weatherPool: ['clear'],
		directorMinInterval: 60,
		directorMaxInterval: 300,
		directorMinIntervalSec: 60,
		directorMaxIntervalSec: 300,
	} as any,
	ambient: {
		cloudDensityShift: 0.08,
		cloudDensityMin: 0.05,
		cloudDensityMax: 0.95,
		cloudSpeedShift: 0.08,
		cloudSpeedMin: 0.3,
		cloudSpeedMax: 1.6,
		hazeShift: 0.02,
		hazeMin: 0,
		hazeMax: 0.18,
	},
};
