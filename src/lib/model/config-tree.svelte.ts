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


/** Config namespace keys — SSOT shared with API allowlist. */
export const CONFIG_NAMESPACE_KEYS = ['atmosphere', 'camera', 'director', 'world', 'shell'] as const;
export type ConfigNamespace = (typeof CONFIG_NAMESPACE_KEYS)[number];
import { WEATHER_EFFECTS } from '$content/weather';
import { type DeviceRole, type QualityMode, type WeatherType } from '$lib/types';
import { CRDTStore, setCRDTDeviceId, getCRDTDeviceId } from './crdt-store';
import { setByPath, readByPath } from '$lib/utils';

// ─── Atmosphere ───────────────────────────────────────────────────────────────

export const atmosphere = $state({
	clouds: {
		density: 0.85,   // CLOUD_DENSITY_MAX(1.0) * 0.85
		speed: 0.6,      // CLOUD_SPEED_MIN(0.2) + 0.4
		layerCount: 3,
		opacityScale: 1.0, // Multiplies per-sprite opacity at frame time (Three-side tuner).
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
		arrivalHoldMs: number;
		minSpeed: number;
		maxSpeed: number;
	};
	motion: {
		bankAngleMax: number;
		bankSmoothing: number;
		bankPitchCouple: number;
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
		fuselageOffsetM: number;
	};
	/** Camera pitch override in degrees (0 = off → normal wing-out look; e.g.
	 *  −60 looks DOWN at the city). Lab "night flyover" preview; ship = 0. */
	flyoverPitchDeg: number;
	effectiveHeading(this: CameraShape, baseHeading: number): number;
}

const _camera: CameraShape = {
	orbit: {
				driftRate: 0.018, // orbit lateral speed (deg/s at speed=1)
		major: 0.15,
		minor: 0.06,
		majorMin: 0.08,
		majorMax: 0.25,
		breathePeriod: 180,
	},
	cruise: {
		departureDurationSec: 2.0,
		transitDurationSec: 2.0,
		arrivalHoldMs: 8000,
		minSpeed: 0.1,
		maxSpeed: 3.0,
	},
	motion: {
				bankAngleMax: 16.0, // max horizon tilt on turns
		bankSmoothing: 2.5,
				bankPitchCouple: 0.9, // tilt-to-pitch coupling (more ground/sky)
				breathingPeriod: 22, // cabin nose up/down cycle
		breathingAmplitude: 2.6,
				engineVibeFreqX: 7, // engine hum freq
		engineVibeFreqY: 11, // offset to avoid Lissajous lock
		engineVibeAmp: 0.5, // hum amplitude
				bumpMinInterval: 75, // min sec between turbulence bumps
		bumpMaxInterval: 260,
		bumpDecay: 6, // bump decay rate
		bumpRingFreq: 7, // bump ring frequency
		bumpAmplitude: 0.35, // bump amplitude
		turbulenceMultipliers: { severe: 0.55, moderate: 0.3, light: 0.18 },
		turbulenceOffsetY: 0.008, // turbulence chatter range
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
				fuselageOffsetM: 0, // multi-Pi wing perspective offset
	},
	flyoverPitchDeg: 0, // 0 = off (ship). Lab night-flyover sets ~−60 to look down.
	effectiveHeading(this: typeof _camera, baseHeading: number): number {
		return (baseHeading + this.parallax.headingOffsetDeg + 360) % 360;
	},
};

export const camera = $state(_camera);

export type CameraConfig = typeof _camera;

function headingOffsetForRole(role: DeviceRole, panoramaArcDeg = 44): number {
	switch (role) {
		case 'left':  return -panoramaArcDeg / 2 + panoramaArcDeg / 6;
		case 'right': return  panoramaArcDeg / 2 - panoramaArcDeg / 6;
		default:            return 0;
	}
}

function fuselageOffsetForRole(role: DeviceRole): number {
	switch (role) {
		case 'left':  return -6;
		case 'right': return  6;
		default:            return 0;
	}
}
export function setParallaxRole(role: DeviceRole): void {
	camera.parallax.role = role;
	camera.parallax.headingOffsetDeg = headingOffsetForRole(role, camera.parallax.panoramaArcDeg);
	camera.parallax.fuselageOffsetM = fuselageOffsetForRole(role);
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
				initialMinDelay: 120,
		initialMaxDelay: 300,
		subsequentMinDelay: 180,
		subsequentMaxDelay: 480,
		weatherChangeChance: 0.2,
		weatherPool: Object.freeze(['clear', 'cloudy', 'cloudy', 'rain', 'overcast', 'storm']) as readonly WeatherType[],
				directorMinInterval: 240,      // 4:00
		directorMaxInterval: 360,      // 6:00
				nightLitCitiesOnly: true, // auto-flight only to lit cities at night
				vantage: {
			enabled: true,
			// Only fires at night (nightFactor > this) — the beat is a
			// city-lights moment; by day it would be a downward tilt at
			// bright terrain. Gates the whole thing to the evening/night loop.
			minNightFactor: 0.6,
			// Interval window in seconds between beats (~15–40 min).
			minIntervalSec: 900,
			maxIntervalSec: 2400,
			// How long the flyover holds before auto-returning to orbit.
			durationSec: 45,
			// Camera look-down pitch while active (deg). compose.ts applies it.
			pitchDeg: -60,
			// Altitude to descend to for the beat (feet) — low enough to read
			// the street grid, clamped to camera.altitude.min at apply time.
			altitudeFt: 9000,
		},
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
		useThreeOverlay: true, // Three.js overlay on/off
	// Hash-palette night post-process — replaces aero-color-grade with the
	// 3-stop sodium/amber/warm-white palette + 3% red sparks (Apr-15).
	// Default true: this IS the production night look. Toggle off via SidePanel
	// or ?hashpalette=0 to revert to aero-color-grade for comparison.
	useHashPalette: true,
		baseNightSaturation: 0.30, // keep some colour at dusk, shader desat handles night
		nightLightIntensity: 5.0, // VIIRS + shader city-glow intensity
		bloomContrast: 128,
	bloomBrightness: -0.1, // less darkening, brighter glow
	bloomSigma: 4.5, // bloom spread (wider VIIRS glow)
	buildingsEnabled: true,
		buildingEmissiveLowAltFt: 25000, // building glow altitude gate
	buildingEmissiveHighAltFt: 55000,
	buildingEmissiveMax: 0.6, // max window-glow intensity at night
		additiveStrength: 5.0, // emissive boost on lit pixels
		moonlightIntensity: 0.08,
	nightExposure: 0.75,
	darkVoidStrength: 0.01, // dark-crush floor (nearly off)
	envLight: 4.0, // terrain ambient floor (night visibility)
		atmosphereLight: 1.6, // globe limb-scatter intensity
		skyDarken: 1.8, // sky-atmosphere brightness shift
	viirsBrightness: 3.0, // VIIRS layer brightness
	viirsAlphaBoost: 1.4,
	windowLightIntensity: 1.5, // procedural building-window brightness
		viirsAltGateLowFt: 5000, // VIIRS dim-below-cruise altitude gate
	viirsAltGateHighFt: 15000,
	showClouds: true,
		useCesiumClouds: true, // Cesium cloud billboards (1 draw call, GPU-instanced)
	ambientOcclusion: true, // HBAO (altitude-gated)
	qualityMode: 'performance' as QualityMode, // quality preset
});


// ─── Shell ───────────────────────────────────────────────────────────────────

export const shell = $state({
		windowFrame: false, // cabin oval border
	blindOpen: true,
	hudVisible: true,
	sidePanelOpen: false,
		clockVisible: false, // lab-scope wall-clock overlay
		mouseParallax: true, // cursor parallax (no-op in kiosk)
		sidePanelAutoCloseMs: 15000, // auto-close idle side panel
	// Touch-contract gate (Q3 council 2026-05-20). false = passenger mode: basic
	// blind drag is the ONLY touch interaction — the curtain metaphor. true =
	// demo/operator mode: long-press acceleration + future multi-touch gestures
	// become live. Lobby installs ship with false; operator iPad PATCHes shell.
	// touchEnabled=true via /api/config for guided demos. Auto-revert timer
	// (10-min) is a v1.1 follow-up; for v1 the toggle is sticky.
	touchEnabled: false, // passenger-mode touch safety
});


// ─── Root ────────────────────────────────────────────────────────────────────

export const config = $state({ atmosphere, camera, director, world, shell });

// Flat namespace map — single dispatch point for all path-targeted patches.
// `satisfies` couples the keys to the framework-free CONFIG_NAMESPACE_KEYS
// SSOT (also consumed by the /api/config wire allowlist): add or rename a
// namespace in only one place and the compiler flags the other.
const NAMESPACES = { atmosphere, camera, director, world, shell } as const satisfies Record<ConfigNamespace, object>;

// ─── CRDT layer ─────────────────────────────────────────────────────────────

const _configRoot: Record<string, unknown> = config as unknown as Record<string, unknown>;
const crdt = new CRDTStore(_configRoot);

/**
 * Sync atmosphere.weather fields from a weather effect recipe.
 * Each field is stamped through the CRDT so concurrent admin PATCHes
 * to the same fields participate in LWW merge — previously Object.assign
 * bypassed CRDT and would silently clobber fleet-config writes.
 */
export function syncAtmosphereWeather(
	fx: { turbulence: 'light' | 'moderate' | 'severe'; hasLightning: boolean; rainOpacity: number; windAngle: number; cloudDensityRange: [number, number]; nightCloudFloor: number; filterBrightness: number },
): void {
	for (const [key, value] of Object.entries(fx)) {
		const path = `atmosphere.weather.${key}`;
		// Route through applyConfigPatch so all config writes go through one
		// path: setByPath validation → idempotency skip → CRDT stamp. Previously
		// this wrote directly and stamped CRDT separately — two mutation paths.
		const newValue = key === 'cloudDensityRange' ? [...value as [number, number]] : value;
		applyConfigPatch(path, newValue);
	}
}

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

	// Idempotency: when the value is already what we're being asked to set,
	// skip the CRDT stamp + setByPath. Saves a per-keystroke peer-sync PATCH
	// on slider snap-back, a telemetry event, and the downstream $effect
	// invalidations. Object.is so NaN-vs-NaN counts as "unchanged."
	const rootRec = root as unknown as Record<string, unknown>;
	const existing = readByPath(rootRec, rest);

	// Idempotency: when the value is already what we're being asked to set,
	// skip the CRDT stamp + setByPath. Saves a per-keystroke peer-sync PATCH
	// on slider snap-back, a telemetry event, and the downstream $effect
	// invalidations. Object.is so NaN-vs-NaN counts as "unchanged."
	if (Object.is(existing, value)) return true;

	// Type guard: reject patches whose value type doesn't match the existing
	// config leaf. Prevents 'potato' → number field from corrupting runtime.
	if (typeof value !== typeof existing) return false;

	// Write config FIRST — if setByPath fails (bogus path), we must not
	// have stamped the CRDT. Previously crdt.set() ran before setByPath(),
	// so a failed write left a stale CRDT timestamp with no config change.
	if (!setByPath(rootRec, rest, value)) return false;
	crdt.set(path, value);
	return true;
}

/** Export device ID for use in fleet message sourceId field. */
export { setCRDTDeviceId, getCRDTDeviceId };

// ─── Auto-quality stepping ─────────────────────────────────────────────────────

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
