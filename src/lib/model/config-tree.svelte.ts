/**
 * Config — flat reactive state for all tuneable parameters.
 *
 * This is the SSOT for every tuning number the app exposes. Consumers
 * read from `config.*` rather than importing raw constants; the default
 * literals below are the place to edit tuning.
 *
 * Design:
 * - One $state object per namespace (no class-per-namespace)
 * - Generic setByPath(root, path, value) handles ALL mutations — no switch statements
 * - Sync functions (syncFromMode, syncFromEffects) are plain functions, not class methods
 */

import { WEATHER_EFFECTS } from '$content/weather';
import { QUALITY_MODES, type DeviceRole, type QualityMode, type WeatherType } from '$lib/types';
import { headingOffsetForRole } from '$lib/fleet/parallax.svelte';
import { createCRDTStore, setCRDTDeviceId, getCRDTDeviceId } from './crdt-store';
import { setByPath } from '$lib/utils';

// ─── Atmosphere ───────────────────────────────────────────────────────────────

export const atmosphere = $state({
	clouds: {
		density: 0.85,   // CLOUD_DENSITY_MAX(1.0) * 0.85
		speed: 0.6,      // CLOUD_SPEED_MIN(0.2) + 0.4
		layerCount: 3,
	},
	haze: {
		amount: 0.07,    // HAZE_MIN(0) + 0.07
		min: 0,
		max: 0.15,
	},
	weather: {
		turbulence: WEATHER_EFFECTS.cloudy.turbulence,
		hasLightning: WEATHER_EFFECTS.cloudy.hasLightning,
		rainOpacity: WEATHER_EFFECTS.cloudy.rainOpacity,
		windAngle: WEATHER_EFFECTS.cloudy.windAngle,
		cloudDensityRange: [...WEATHER_EFFECTS.cloudy.cloudDensityRange] as [number, number],
		nightCloudFloor: WEATHER_EFFECTS.cloudy.nightCloudFloor,
		filterBrightness: WEATHER_EFFECTS.cloudy.filterBrightness,
		frostStartAltitude: 25000,   // feet
		frostMaxAltitude:   40000,   // feet
		lightningMinInterval: 5,     // seconds
		lightningMaxInterval: 30,
		lightningDecayRate:   8,
	},
	microEvents: {
		// Moments of surprise for attentive viewers.
		minInterval: 100,            // seconds between events (lower bound)
		maxInterval: 300,
		shootingStarDuration: 1.5,
		birdDuration: 8,
		contrailDuration: 12,
	},
});

export function syncAtmosphereWeather(
	fx: { turbulence: 'light' | 'moderate' | 'severe'; hasLightning: boolean; rainOpacity: number; windAngle: number; cloudDensityRange: [number, number]; nightCloudFloor: number; filterBrightness: number },
): void {
	Object.assign(atmosphere.weather, fx);
}


// ─── Camera ──────────────────────────────────────────────────────────────────

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
		// Flight drift in degrees/second at speed=1.0. 0.01 gives commercial-cruise
		// pace at the default 1.4x (~2.3× earlier 0.006 setting's apparent motion).
		driftRate: 0.01,
		major: 0.15,            // degrees (~17 km) long axis
		minor: 0.06,            // degrees (~7 km) short axis — ~2.5:1 aspect
		majorMin: 0.08,         // tightest orbit (dense city passes)
		majorMax: 0.25,         // widest orbit (sweeping vistas)
		breathePeriod: 180,     // seconds per full breathe cycle
	},
	cruise: {
		departureDurationSec: 2.0,
		transitDurationSec: 2.0,
		defaultSpeed: 1.4,
		minSpeed: 0.1,
		maxSpeed: 3.0,
	},
	motion: {
		// Banking — horizon tilt during orbit turns.
		bankAngleMax: 6.0,
		bankSmoothing: 2.5,
		// Pitch breathing — slow nose up/down oscillation.
		breathingPeriod: 22,
		breathingAmplitude: 1.5,
		// Engine micro-vibration — constant fine hum.
		engineVibeFreqX: 7,     // Hz
		engineVibeFreqY: 11,    // Hz (different to avoid Lissajous lock)
		engineVibeAmp: 0.35,    // pixels
		// Turbulence bumps — occasional jolts.
		bumpMinInterval: 30,
		bumpMaxInterval: 120,
		bumpDecay: 8,
		bumpRingFreq: 15,
		bumpAmplitude: 3,
		turbulenceMultipliers: { severe: 3, moderate: 1.5, light: 1 },
		turbulenceOffsetY: 0.05,
	},
	altitude: {
		default: 35000,         // feet
		min: 10000,
		max: 65000,
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
	camera.parallax.headingOffsetDeg = headingOffsetForRole(role, camera.parallax.panoramaArcDeg);
}


// ─── Director ─────────────────────────────────────────────────────────────────

export const director = $state({
	daylight: {
		syncToRealTime: true,
		manualTimeOfDay: 12,
		syncIntervalMs: 60_000,        // 1 minute
	},
	autopilot: {
		enabled: true,
		// Timer windows in seconds. First change waits 2-5 min; subsequent
		// changes 3-8 min. Director location cycles avg ~2:10 per location.
		initialMinDelay: 120,
		initialMaxDelay: 300,
		subsequentMinDelay: 180,
		subsequentMaxDelay: 480,
		weatherChangeChance: 0.2,
		weatherPool: Object.freeze(['clear', 'cloudy', 'cloudy', 'rain', 'overcast']) as readonly WeatherType[],
		directorMinInterval: 100,      // 1:40
		directorMaxInterval: 160,      // 2:40
	},
	ambient: {
		// Drift ranges per randomisation cycle.
		cloudDensityShift: 0.3,
		cloudDensityMin: 0.2,
		cloudDensityMax: 1.0,
		cloudSpeedShift: 0.4,
		cloudSpeedMin: 0.2,
		cloudSpeedMax: 1.5,
		hazeShift: 0.04,
		hazeMin: 0,
		hazeMax: 0.15,
	},
});


// ─── World ───────────────────────────────────────────────────────────────────

export const world = $state({
	// Base imagery dim at full night. 0.10 (was 0.15) — deeper terrain crush
	// so VIIRS amber + CartoDB road grid pop harder against the dark ground.
	// Composite math: Cesium imagery layers alpha-blend, so the only way to
	// make lit areas "glow" is to deepen the unlit floor underneath.
	baseNightBrightness: 0.10,
	baseNightSaturation: 0.18,
	// Night city glow overlay (CartoDB Dark) composited on the dimmed base.
	// Brightness 1.6 keeps roads visible without blowing to pure white.
	nightAlpha: 0.8,
	nightBrightness: 1.6,
	nightContrast: 1.6,
	nightLightIntensity: 0.6,
	// Bloom post-process — sigma sets Gaussian spread, contrast sets the
	// luminance threshold above which pixels contribute. Wider sigma + lower
	// contrast = softer, broader glow — lit roads pool into city haze rather
	// than reading as discrete pin-pricks. Negative brightness keeps dim
	// terrain from contributing.
	bloomContrast: 100,
	bloomBrightness: -0.3,
	bloomSigma: 3.4,
	buildingsEnabled: true,
	showClouds: true,
	qualityMode: 'balanced' as QualityMode,
	autoQuality: true,
});


// ─── Shell ───────────────────────────────────────────────────────────────────

export const shell = $state({
	windowFrame: true,
	blindOpen: true,
	hudVisible: true,
	sidePanelOpen: false,
	showWing: true,
});


// ─── Root ────────────────────────────────────────────────────────────────────

export const config = $state({ atmosphere, camera, director, world, shell });

// Flat namespace map — single dispatch point for all path-targeted patches.
const NAMESPACES = { atmosphere, camera, director, world, shell } as const;

// ─── CRDT layer ─────────────────────────────────────────────────────────────

const _configRoot: Record<string, unknown> = config as unknown as Record<string, unknown>;
const crdt = createCRDTStore(_configRoot);

/**
 * Apply a path-keyed patch to the config tree.
 *
 * Local writes (no `remote` arg) stamp with `Date.now()` + current
 * device id and write through. Remote writes (with `remote` arg) route
 * through CRDT merge — the incoming patch only applies if its
 * timestamp beats the local last-writer for this path, with sourceId
 * lexicographic tiebreak on equal timestamps.
 *
 * Returns true if the write was applied. For remote writes, false means
 * "lost the CRDT race" (stale); for local writes, false means "unknown
 * namespace or invalid path segment."
 */
export function applyConfigPatch(
	path: string,
	value: unknown,
	remote?: { timestamp: number; sourceId: string },
): boolean {
	if (remote) return crdt.merge({ path, value, ...remote });

	const idx = path.indexOf('.');
	if (idx < 0) return false;
	const ns = path.slice(0, idx) as keyof typeof NAMESPACES;
	const rest = path.slice(idx + 1);
	const root = NAMESPACES[ns];
	if (!root) return false;

	crdt.set(path, value);
	return setByPath(root as unknown as Record<string, unknown>, rest, value);
}

/**
 * Syncs parallax role across CRDT, local state, and heading-offset side-effect.
 * Called directly by fleet role_assign so the heading-offset propagates atomically.
 */
export function setParallaxRoleWithSync(role: DeviceRole): void {
	crdt.set('camera.parallax.role', role);
	setByPath(camera as unknown as Record<string, unknown>, 'parallax.role', role);
	setParallaxRole(role);
}

/** Export device ID for use in fleet message sourceId field. */
export { setCRDTDeviceId, getCRDTDeviceId };

// ─── Auto-quality stepping ─────────────────────────────────────────────────────

/**
 * Bands: below 20 fps → step down one level, above 40 fps → step up.
 * Returns the same mode if inside the hysteresis band, or if already at
 * the extreme of the available presets.
 */
export function nextQualityMode(fps: number, current: QualityMode): QualityMode {
	if (fps <= 0) return current;
	const idx = QUALITY_MODES.indexOf(current);
	if (fps < 20 && idx > 0) return QUALITY_MODES[idx - 1];
	if (fps > 40 && idx < QUALITY_MODES.length - 1) return QUALITY_MODES[idx + 1];
	return current;
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
