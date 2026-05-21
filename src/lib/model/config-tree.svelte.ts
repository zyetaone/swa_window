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
import { setByPath, readByPath } from '$lib/utils';

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
		arrivalHoldMs: number;
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
		arrivalHoldMs: 8000,
		defaultSpeed: 1.4,
		minSpeed: 0.1,
		maxSpeed: 3.0,
	},
	motion: {
		// Banking — horizon tilt during orbit turns. Phase 10b (user direction
		// "improve tilt on plane rotation, to the left more sky to the right
		// more ground"): bumped 6→10 for a more dramatic horizon roll when the
		// scene rotates. The motion.svelte.ts tick still ramps softly via
		// bankSmoothing — visible cabin tilt, not a snap.
		bankAngleMax: 10.0,
		bankSmoothing: 2.5,
		// Pitch breathing — slow nose up/down oscillation.
		breathingPeriod: 22,
		breathingAmplitude: 1.5,
		// Engine micro-vibration — constant fine hum.
		engineVibeFreqX: 7,     // Hz
		engineVibeFreqY: 11,    // Hz (different to avoid Lissajous lock)
		engineVibeAmp: 0.35,    // pixels
		// Turbulence bumps — occasional jolts. Phase 10b (user direction
		// "reduce turbulence jerks"): amplitudes pulled below the Phase-10
		// numbers and a soft-onset envelope added in motion.svelte.ts. Office
		// install context wants AMBIENT motion, not turbulent flight.
		bumpMinInterval: 60,        // longer gaps between bumps
		bumpMaxInterval: 220,
		bumpDecay: 6,               // slower decay reads as a softer wash
		bumpRingFreq: 7,            // lower osc freq → less rapid wobble
		bumpAmplitude: 0.7,         // was 1.4 — half the jolt again
		turbulenceMultipliers: { severe: 0.9, moderate: 0.5, light: 0.3 },
		turbulenceOffsetY: 0.015,   // chatter range halved
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
		weatherPool: Object.freeze(['clear', 'cloudy', 'cloudy', 'rain', 'overcast', 'storm']) as readonly WeatherType[],
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
	// Base imagery night-time saturation. Near-zero so the green Sentinel-2
	// vegetation + blue water don't bleed through as a hue cast under the
	// shader's navy mix. baseNightBrightness was removed in Phase 15.5 —
	// the shader's COLOR_GRADING_GLSL handles all darkening via mix(rgb,
	// navy, smoothstep(0.45, 0.9, nf) * 0.85).
	baseNightSaturation: 0.05,
	// nightLightIntensity multiplies VIIRS alpha (and the shader's pollution
	// corona) — the operator's "how lit do cities feel" knob.
	nightLightIntensity: 0.6,
	// Bloom post-process — high contrast + negative brightness means only the
	// top of the luminance range blooms. Sigma controls the Gaussian spread.
	bloomContrast: 128,
	bloomBrightness: -0.3,
	bloomSigma: 2.2,
	buildingsEnabled: true,
	// Phase 3 (variant E productionized) — buildings glow amber at low altitude
	// (passenger-window mode) and fade above cruise altitude. The blend is on
	// raw flight.altitude in feet so it tracks descent/climb naturally during
	// cruise→orbit transitions. Defaults from night-lab E_DEFAULTS.
	buildingEmissiveLowAltFt: 15000,
	buildingEmissiveHighAltFt: 25000,
	buildingEmissiveMax: 0.6,
	// Phase 9 (Apr-15 hash palette + Cesium API knobs productionized from
	// night-lab Variants G + H). Defaults below were tuned in the lab against
	// Hyderabad night view; operators can adjust via admin panel for on-site
	// fine-tune. The 6 shader uniforms (palette / chroma / dark void / env /
	// ambient) feed COLOR_GRADING_GLSL; the 6 scene uniforms (moonlight /
	// exposure / atmosphere / sky / viirs) drive compose.ts scene-lighting.
	paletteSpread: 0.25,        // hash range — per-pixel palette variance
	additiveStrength: 7.0,      // emissive boost on lit pixels (calm-amber)
	redSparkRate: 0.03,         // fraction of lit pixels going traffic-red
	darkVoidStrength: 0.3,      // crush unlit terrain toward black at night
	envLight: 0.5,              // ambient warm moonlight floor (DOM-side)
	viirsMaskStrength: 0.85,    // chroma gate — restrict palette to warm pixels
	moonlightIntensity: 0.08,   // DirectionalLight peak intensity (full moon, deep night)
	nightExposure: 0.85,        // postProcessStages.exposure at deep night (1.0 day)
	atmosphereLight: 3.0,       // globe.atmosphereLightIntensity at night (Cesium default 10)
	skyDarken: 1.6,             // multiplier on skyAtmosphere.brightnessShift
	viirsBrightness: 1.5,       // multiplier on viirsLayer.brightness (set at setup)
	viirsAlphaBoost: 1.4,       // multiplier on viirsLayer.alpha (per-frame in syncImagery)
	// Phase 6 (altitude-gate VIIRS) — dim NASA Black Marble below cruise so
	// it doesn't compete with the building emissive at passenger-window
	// altitudes. At cruise (>15kft) VIIRS is full strength; below 5kft VIIRS
	// is fully off. Pairs with the building emissive band (15-25kft) so the
	// city-light load smoothly crossfades between sources during ascent.
	viirsAltGateLowFt: 5000,
	viirsAltGateHighFt: 15000,
	showClouds: true,
	qualityMode: 'balanced' as QualityMode,
	autoQuality: true,
});


// ─── Shell ───────────────────────────────────────────────────────────────────

export const shell = $state({
	// Phase 10 (user direction): window frame OFF by default — full-bleed
	// Cesium fills the viewport, the airplane-cabin oval is opt-in via the
	// SidePanel toggle. Reverses the Phase 14 default. Show/bundle configs
	// can still override for specific install presentations.
	windowFrame: false,
	blindOpen: true,
	hudVisible: true,
	sidePanelOpen: false,
	showWing: true,
	// Phase 10 interactivity prototype — cursor parallax. When true and a
	// mouse is present (kiosk with hidden cursor effectively has none),
	// scene-content gets a subtle ~12px max offset based on cursor position
	// from viewport center. Smoothed via RAF lerp. Default ON in dev (we
	// strip html.kiosk in dev), default ON in prod too — Chromium kiosk has
	// no real mouse so behavior is unchanged. Operator can disable via
	// SidePanel. The "look around" feel borrowed from Three.js demos.
	mouseParallax: true,
	// Auto-close the side panel after N ms of inactivity (no pointer move
	// inside the panel). 15000 is the Game Designer's "non-demo reading-and-
	// deciding threshold." 0 disables — on-site techs flip to 0 while
	// debugging so the panel stays open. Activity = pointermove inside the
	// panel; opening always resets the timer. Per v2 council (2026-05-21).
	sidePanelAutoCloseMs: 15000,
	// Touch-contract gate (Q3 council 2026-05-20). false = passenger mode: basic
	// blind drag is the ONLY touch interaction — the curtain metaphor. true =
	// demo/operator mode: long-press acceleration + future multi-touch gestures
	// become live. Lobby installs ship with false; operator iPad PATCHes shell.
	// touchEnabled=true via /api/config for guided demos. Auto-revert timer
	// (10-min) is a v1.1 follow-up; for v1 the toggle is sticky.
	touchEnabled: false,
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

	// Idempotency: when the value is already what we're being asked to set,
	// skip the CRDT stamp + setByPath. Saves a per-keystroke peer-sync PATCH
	// on slider snap-back, a telemetry event, and the downstream $effect
	// invalidations. Object.is so NaN-vs-NaN counts as "unchanged."
	const rootRec = root as unknown as Record<string, unknown>;
	if (Object.is(readByPath(rootRec, rest), value)) return true;

	crdt.set(path, value);
	return setByPath(rootRec, rest, value);
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
