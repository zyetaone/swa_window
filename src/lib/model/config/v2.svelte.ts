/**
 * Config — flat reactive state for all tuneable parameters.
 *
 * Design:
 * - One $state object per namespace (no class-per-namespace)
 * - Generic setByPath(root, path, value) handles ALL mutations — no switch statements
 * - Sync functions (syncFromMode, syncFromEffects) are plain functions, not class methods
 * - toJSON() is a plain spread of the reactive tree — no manual field mapping
 *
 * SSOT defaults: constants.ts (AIRCRAFT, AMBIENT, MICRO_EVENTS, WEATHER_EFFECTS,
 * CESIUM, CESIUM_QUALITY_PRESETS). Every $state field initialises from these.
 */

import { CESIUM, CESIUM_QUALITY_PRESETS, AIRCRAFT, AMBIENT, MICRO_EVENTS, WEATHER_EFFECTS } from '$lib/constants';
import type { QualityMode, WeatherType } from '$lib/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): boolean {
	const segments = path.split('.');
	let current: Record<string, unknown> = obj;
	for (let i = 0; i < segments.length - 1; i++) {
		const next = current[segments[i]];
		if (typeof next !== 'object' || next === null) return false;
		current = next as Record<string, unknown>;
	}
	const key = segments[segments.length - 1];
	if (!(key in current)) return false;
	current[key] = value;
	return true;
}

// ─── Atmosphere ───────────────────────────────────────────────────────────────

export const atmosphere = $state({
	clouds: {
		density: AMBIENT.CLOUD_DENSITY_MAX * 0.85,
		speed: AMBIENT.CLOUD_SPEED_MIN + 0.4,
		layerCount: 3,
	},
	haze: {
		amount: AMBIENT.HAZE_MIN + 0.07,
		min: AMBIENT.HAZE_MIN,
		max: AMBIENT.HAZE_MAX,
	},
	weather: {
		turbulence: WEATHER_EFFECTS.cloudy.turbulence,
		hasLightning: WEATHER_EFFECTS.cloudy.hasLightning,
		rainOpacity: WEATHER_EFFECTS.cloudy.rainOpacity,
		windAngle: WEATHER_EFFECTS.cloudy.windAngle,
		cloudDensityRange: [...WEATHER_EFFECTS.cloudy.cloudDensityRange] as [number, number],
		nightCloudFloor: WEATHER_EFFECTS.cloudy.nightCloudFloor,
		filterBrightness: WEATHER_EFFECTS.cloudy.filterBrightness,
		frostStartAltitude: AIRCRAFT.FROST_START_ALTITUDE as number,
		frostMaxAltitude: AIRCRAFT.FROST_MAX_ALTITUDE as number,
		lightningMinInterval: AIRCRAFT.LIGHTNING_MIN_INTERVAL as number,
		lightningMaxInterval: AIRCRAFT.LIGHTNING_MAX_INTERVAL as number,
		lightningDecayRate: AIRCRAFT.LIGHTNING_DECAY_RATE as number,
	},
	microEvents: {
		minInterval: MICRO_EVENTS.MIN_INTERVAL as number,
		maxInterval: MICRO_EVENTS.MAX_INTERVAL as number,
		shootingStarDuration: MICRO_EVENTS.SHOOTING_STAR_DURATION as number,
		birdDuration: MICRO_EVENTS.BIRD_DURATION as number,
		contrailDuration: MICRO_EVENTS.CONTRAIL_DURATION as number,
	},
});

export function syncAtmosphereWeather(
	fx: { turbulence: 'light' | 'moderate' | 'severe'; hasLightning: boolean; rainOpacity: number; windAngle: number; cloudDensityRange: [number, number]; nightCloudFloor: number; filterBrightness: number },
): void {
	Object.assign(atmosphere.weather, fx);
}

export function setAtmospherePath(path: string, value: unknown): boolean {
	return setByPath(atmosphere as unknown as Record<string, unknown>, path, value);
}

// ─── Camera ──────────────────────────────────────────────────────────────────

export type DeviceRole = 'solo' | 'left' | 'center' | 'right';

interface CameraShape {
	orbit: {
		driftRate: number;
		major: number;
		minor: number;
		majorMin: number;
		majorMax: number;
		breathePeriod: number;
	};
	cruise: {
		departureDurationSec: number;
		transitDurationSec: number;
		defaultSpeed: number;
		minSpeed: number;
		maxSpeed: number;
	};
	motion: {
		bankAngleMax: number;
		bankSmoothing: number;
		breathingPeriod: number;
		breathingAmplitude: number;
		engineVibeFreqX: number;
		engineVibeFreqY: number;
		engineVibeAmp: number;
		bumpMinInterval: number;
		bumpMaxInterval: number;
		bumpDecay: number;
		bumpRingFreq: number;
		bumpAmplitude: number;
		turbulenceMultipliers: { severe: number; moderate: number; light: number };
		turbulenceOffsetY: number;
	};
	altitude: {
		default: number;
		min: number;
		max: number;
	};
	parallax: {
		role: DeviceRole;
		headingOffsetDeg: number;
		fovDeg: number;
		panoramaArcDeg: number;
	};
	effectiveHeading(this: CameraShape, baseHeading: number): number;
}

const _camera: CameraShape = {
	orbit: {
		driftRate: AIRCRAFT.DRIFT_RATE as number,
		major: AIRCRAFT.ORBIT_MAJOR as number,
		minor: AIRCRAFT.ORBIT_MINOR as number,
		majorMin: AIRCRAFT.ORBIT_MAJOR_MIN as number,
		majorMax: AIRCRAFT.ORBIT_MAJOR_MAX as number,
		breathePeriod: AIRCRAFT.ORBIT_BREATHE_PERIOD as number,
	},
	cruise: {
		departureDurationSec: 2.0,
		transitDurationSec: 2.0,
		defaultSpeed: 1.4,
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
		default: AIRCRAFT.DEFAULT_ALTITUDE as number,
		min: AIRCRAFT.MIN_ALTITUDE as number,
		max: AIRCRAFT.MAX_ALTITUDE as number,
	},
	parallax: {
		role: 'solo' as DeviceRole,
		headingOffsetDeg: 0,
		fovDeg: 60,
		panoramaArcDeg: 44,
	},
	effectiveHeading(this: typeof _camera, baseHeading: number): number {
		return (baseHeading + this.parallax.headingOffsetDeg + 360) % 360;
	},
};

export const camera = $state(_camera);

export type CameraConfig = typeof _camera;

export function setParallaxRole(role: DeviceRole): void {
	camera.parallax.role = role;
	if (role === 'solo' || role === 'center') {
		camera.parallax.headingOffsetDeg = 0;
	} else if (role === 'left') {
		camera.parallax.headingOffsetDeg = -camera.parallax.panoramaArcDeg / 2 + camera.parallax.panoramaArcDeg / 6;
	} else {
		camera.parallax.headingOffsetDeg = camera.parallax.panoramaArcDeg / 2 - camera.parallax.panoramaArcDeg / 6;
	}
}

export function setCameraPath(path: string, value: unknown): boolean {
	if (path.startsWith('parallax.role')) {
		setByPath(camera as unknown as Record<string, unknown>, 'parallax.role', value);
		setParallaxRole(value as DeviceRole);
		return true;
	}
	return setByPath(camera as unknown as Record<string, unknown>, path, value);
}

// ─── Director ─────────────────────────────────────────────────────────────────

export const director = $state({
	daylight: {
		syncToRealTime: true,
		manualTimeOfDay: 12,
		syncIntervalMs: AIRCRAFT.REAL_TIME_SYNC_INTERVAL as number,
	},
	autopilot: {
		enabled: true,
		initialMinDelay: AMBIENT.INITIAL_MIN_DELAY as number,
		initialMaxDelay: AMBIENT.INITIAL_MAX_DELAY as number,
		subsequentMinDelay: AMBIENT.SUBSEQUENT_MIN_DELAY as number,
		subsequentMaxDelay: AMBIENT.SUBSEQUENT_MAX_DELAY as number,
		weatherChangeChance: AMBIENT.WEATHER_CHANGE_CHANCE as number,
		weatherPool: ['clear', 'cloudy', 'cloudy', 'rain', 'overcast'] as readonly WeatherType[],
		directorMinInterval: AMBIENT.DIRECTOR_MIN_INTERVAL as number,
		directorMaxInterval: AMBIENT.DIRECTOR_MAX_INTERVAL as number,
	},
	ambient: {
		cloudDensityShift: AMBIENT.CLOUD_DENSITY_SHIFT as number,
		cloudDensityMin: AMBIENT.CLOUD_DENSITY_MIN as number,
		cloudDensityMax: AMBIENT.CLOUD_DENSITY_MAX as number,
		cloudSpeedShift: AMBIENT.CLOUD_SPEED_SHIFT as number,
		cloudSpeedMin: AMBIENT.CLOUD_SPEED_MIN as number,
		cloudSpeedMax: AMBIENT.CLOUD_SPEED_MAX as number,
		hazeShift: AMBIENT.HAZE_SHIFT as number,
		hazeMin: AMBIENT.HAZE_MIN as number,
		hazeMax: AMBIENT.HAZE_MAX as number,
	},
});

export function setDirectorPath(path: string, value: unknown): boolean {
	return setByPath(director as unknown as Record<string, unknown>, path, value);
}

// ─── World ───────────────────────────────────────────────────────────────────

export const world = $state({
	baseNightBrightness: CESIUM.BASE_NIGHT_BRIGHTNESS as number,
	baseNightSaturation: CESIUM.BASE_NIGHT_SATURATION as number,
	nightAlpha: CESIUM.NIGHT_ALPHA as number,
	nightBrightness: CESIUM.NIGHT_BRIGHTNESS as number,
	nightContrast: CESIUM.NIGHT_CONTRAST as number,
	bloomContrast: CESIUM.BLOOM_CONTRAST as number,
	bloomBrightness: CESIUM.BLOOM_BRIGHTNESS as number,
	bloomSigma: CESIUM.BLOOM_SIGMA as number,
	defaultExaggeration: 1.0,
	fogDensityScale: 1.0,
	buildingsEnabled: true,
	overpassRadiusMeters: 3500,
	nightLightIntensity: 0.6,
	qualityMode: 'balanced' as QualityMode,
	msse: CESIUM_QUALITY_PRESETS.balanced.maximumScreenSpaceError,
	tileCache: CESIUM_QUALITY_PRESETS.balanced.tileCacheSize,
	preloadSiblings: CESIUM_QUALITY_PRESETS.balanced.preloadSiblings,
	preloadAncestors: CESIUM_QUALITY_PRESETS.balanced.preloadAncestors,
	loadingDescendantLimit: CESIUM_QUALITY_PRESETS.balanced.loadingDescendantLimit,
});

export function syncWorldQuality(mode: QualityMode): void {
	const p = CESIUM_QUALITY_PRESETS[mode];
	world.msse = p.maximumScreenSpaceError;
	world.tileCache = p.tileCacheSize;
	world.preloadSiblings = p.preloadSiblings;
	world.preloadAncestors = p.preloadAncestors;
	world.loadingDescendantLimit = p.loadingDescendantLimit;
}

export function setWorldPath(path: string, value: unknown): boolean {
	return setByPath(world as unknown as Record<string, unknown>, path, value);
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export const shell = $state({
	windowFrame: true,
	blindOpen: true,
	hudVisible: true,
	sidePanelOpen: false,
	showWing: true,
});

export function setShellPath(path: string, value: unknown): boolean {
	return setByPath(shell as unknown as Record<string, unknown>, path, value);
}

// ─── Root ────────────────────────────────────────────────────────────────────

export const config = $state({ atmosphere, camera, director, world, shell });

/**
 * Dispatch a path-targeted patch to the right namespace.
 * e.g. 'atmosphere.weather.turbulence' → setAtmospherePath('weather.turbulence', value)
 */
export function applyConfigPatch(path: string, value: unknown): boolean {
	const dot = path.indexOf('.');
	if (dot < 0) return false;
	const layer = path.slice(0, dot);
	const rest = path.slice(dot + 1);
	switch (layer) {
		case 'atmosphere': return setAtmospherePath(rest, value);
		case 'camera':     return setCameraPath(rest, value);
		case 'director':   return setDirectorPath(rest, value);
		case 'world':      return setWorldPath(rest, value);
		case 'shell':      return setShellPath(rest, value);
	}
	return false;
}

function deepSnapshot(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === null || v === undefined) {
			out[k] = v;
		} else if (Array.isArray(v)) {
			out[k] = [...v];
		} else if (typeof v === 'object') {
			out[k] = deepSnapshot(v as Record<string, unknown>);
		} else {
			out[k] = v;
		}
	}
	return out;
}

export function configSnapshot() {
	return {
		atmosphere: deepSnapshot(atmosphere as unknown as Record<string, unknown>),
		camera:    deepSnapshot(camera as unknown as Record<string, unknown>),
		director:  deepSnapshot(director as unknown as Record<string, unknown>),
		world:     deepSnapshot(world as unknown as Record<string, unknown>),
		shell:     deepSnapshot(shell as unknown as Record<string, unknown>),
	};
}

// ─── Public types (for consumers that need the shape, not the class) ──────────
// CameraConfig is already declared at line 140 (aliased to typeof _camera).
// DirectorConfig is the only new type export.

export type DirectorConfig = typeof director;
