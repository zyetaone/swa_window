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

import type { ConfigNamespace } from './config-namespaces';
import { WEATHER_EFFECTS } from '$content/weather';
import { type DeviceRole, type QualityMode, type WeatherType } from '$lib/types';
import { headingOffsetForRole, fuselageOffsetForRole } from '$lib/fleet/parallax.svelte';
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
		// Flight drift in degrees/second at speed=1.0. 0.01 gives commercial-cruise
		// pace at the default 1.4x. (A 0.017 bump read as "flying weird" — too fast
		// a pan for the calm scenic mood — so kept at the gentle cruise value.)
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
		// Bank → pitch coupling. Roll alone only TILTS the horizon — it can't
		// show "more ground / more sky". This couples bank into camera pitch
		// so a turn in one direction dips the view toward the ground, and the
		// opposite turn lifts it toward the sky (applied in compose.ts
		// syncCamera). 0.9 → a full 10° bank shifts pitch ~9°, a clear but
		// not vertiginous ground/sky swing. Set 0 to disable.
		bankPitchCouple: 0.9,
		// Pitch breathing — slow nose up/down oscillation. Lifted 1.5 → 2.6 for
		// richer "alive in flight" motion (the cabin gently rises/settles)
		// without adding turbulence jolts (kept low per prior direction).
		breathingPeriod: 22,
		breathingAmplitude: 2.6,
		// Engine micro-vibration — constant fine hum. 0.35 → 0.5 so the view
		// has a subtle living shimmer at rest, not a dead-still frame.
		engineVibeFreqX: 7,     // Hz
		engineVibeFreqY: 11,    // Hz (different to avoid Lissajous lock)
		engineVibeAmp: 0.5,     // pixels
		// Turbulence bumps — occasional jolts. Phase 11 (user direction
		// "turbulence to be lower"): cut amplitude and multipliers in half
		// AGAIN after the Phase-10b softening. Office install reads as a
		// floating cabin, not "we're hitting weather". The soft-onset
		// envelope in motion.svelte.ts handles the perceptual jerk; these
		// numbers handle the perceptual presence.
		bumpMinInterval: 75,        // longer gaps between bumps
		bumpMaxInterval: 260,
		bumpDecay: 6,               // slower decay reads as a softer wash
		bumpRingFreq: 7,            // lower osc freq → less rapid wobble
		bumpAmplitude: 0.35,        // was 0.7 — halved again
		turbulenceMultipliers: { severe: 0.55, moderate: 0.3, light: 0.18 },
		turbulenceOffsetY: 0.008,   // chatter range halved again
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
		// Position offset along the fuselage axis (camera-local Z), in metres.
		// Used by Wing.svelte so each Pi in a 3-Pi panorama sees a different
		// portion of the same wing — front Pi (negative) sees leading edge,
		// back Pi (positive) sees trailing edge. solo / center = 0.
		// Heading offset rotates the view; fuselage offset translates the
		// viewer along the fuselage so the wing perspective shifts.
		fuselageOffsetM: 0,
	},
	flyoverPitchDeg: 0, // 0 = off (ship). Lab night-flyover sets ~−60 to look down.
	effectiveHeading(this: typeof _camera, baseHeading: number): number {
		return (baseHeading + this.parallax.headingOffsetDeg + 360) % 360;
	},
};

export const camera = $state(_camera);

export type CameraConfig = typeof _camera;

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
		// Timer windows in seconds. First change waits 2-5 min; subsequent
		// changes 3-8 min. Director location cycles avg ~2:10 per location.
		initialMinDelay: 120,
		initialMaxDelay: 300,
		subsequentMinDelay: 180,
		subsequentMaxDelay: 480,
		weatherChangeChance: 0.2,
		weatherPool: Object.freeze(['clear', 'cloudy', 'cloudy', 'rain', 'overcast', 'storm']) as readonly WeatherType[],
		// Jul-13 retune: 100/160 (avg ~2:10, passer-by cadence) → 240/360
		// (avg ~5:00). The window lives in peripheral vision for desk-workers
		// eight hours a day — a whole-world change every two minutes read as
		// a slideshow, not calm ambience. Fleet-tunable via director.* if an
		// install wants the livelier gallery pace back.
		directorMinInterval: 240,      // 4:00
		directorMaxInterval: 360,      // 6:00
		// Restrict the director's auto-flight pool to locations where
		// hasBuildings === true (i.e. cities with OSM building extrusions and
		// real VIIRS night-light footprint). When false, the full pool —
		// including ocean / mountain / desert archetypes that look dark at
		// night — is used. Defaulted ON so an unattended kiosk install never
		// wanders into a "lights off" moment between location changes.
		nightLitCitiesOnly: true,
		// ── Night-city flyover beat ──────────────────────────────────────
		// Occasionally the leader pitches the camera DOWN over the lit city
		// (the "descend over the night city" moment from the playground hybrid mode)
		// then returns to orbit. Leader-decided + fleet-broadcast so all 3
		// Pis enter/exit in lock-step (same seam as director_decision). The
		// bounds below are the "controlled" in controlled-randomisation:
		// the roll picks the interval, these walls own the range. Calm by
		// default — a desk-worker sees it a few times a shift, not a ride.
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
	// hybrid-v2 switch (Phase A). true ⇒ ship route / mounts the Three overlay
	// (wing / clouds / moon / photoreal sky / postprocess), camera-mirrored from
	// Cesium — the same composition /playground renders in hybrid mode. false ⇒
	// / renders Cesium only (byte-identical to pre-ship-v1), still the escape
	// hatch if a Pi can't hold framerate.
	//
	// ⚠ Flipped to true by operator decision BEFORE the P8 Pi-5 perf gate ran
	// (ADR-004). Nothing auto-demotes: auto-quality was deleted, and the
	// liveness watchdog only treats fps <= 0 as dead, so a Pi grinding at 8 fps
	// is neither detected nor recovered. Per-Pi escape hatches, in order of
	// reach: `?overlay=0` on the kiosk URL, the SidePanel toggle, or
	// config_patch('world.useThreeOverlay', false) over the fleet — note none of
	// these persist across a reboot, since the flag is not in PersistedState.
	useThreeOverlay: true,
	// Hash-palette night post-process — replaces aero-color-grade with the
	// 3-stop sodium/amber/warm-white palette + 3% red sparks (Apr-15).
	// Default true: this IS the production night look. Toggle off via SidePanel
	// or ?hashpalette=0 to revert to aero-color-grade for comparison.
	useHashPalette: true,
	// Base imagery night-time saturation. Near-zero so the green Sentinel-2
	// vegetation + blue water don't bleed through as a hue cast under the
	// shader's navy mix. baseNightBrightness was removed in Phase 15.5 —
	// the shader's COLOR_GRADING_GLSL handles all darkening via mix(rgb,
	// navy, smoothstep(0.45, 0.9, nf) * 0.85).
	baseNightSaturation: 0.05,
	// nightLightIntensity multiplies VIIRS alpha (and the shader's pollution
	// corona) — the operator's "how lit do cities feel" knob. Bumped 0.6 → 3.0
	// per ship-prep direction. Verified-safe: u_lightIntensity at 3.0 adds
	// 0.04·1·3 = 0.12 to B channel through pollution path — well under the
	// shader's clamp(rgb,0,1) ceiling. VIIRS path has outer Math.min(...,1.0).
	// Building shader fragment-clamps. No saturation regression at 3.0.
	nightLightIntensity: 3.0,
	// Bloom post-process — high contrast + negative brightness means only the
	// top of the luminance range blooms. Sigma controls the Gaussian spread.
	// Phase 11b (user "increase additive light and bloom"): brightness
	// threshold raised slightly (-0.3 → -0.2 — a bit more of the dim range
	// gets bloom) and sigma widened (2.2 → 3.0) so halos pool across more
	// pixels and the lit-city look reads as glow, not pinpricks.
	bloomContrast: 128,
	bloomBrightness: -0.2,
	bloomSigma: 3.0,
	buildingsEnabled: true,
	// Phase 3 (variant E productionized) — buildings glow amber at low altitude
	// (passenger-window mode) and fade above cruise altitude. The blend is on
	// raw flight.altitude in feet so it tracks descent/climb naturally during
	// cruise→orbit transitions. Defaults from night-lab E_DEFAULTS.
	// Window-density gate for the procedural building shader.
	// TODO (post-Pi-perf-gate): replace with altitudeDetailMix SSOT.
	buildingEmissiveLowAltFt: 25000,
	buildingEmissiveHighAltFt: 55000,
	buildingEmissiveMax: 0.6,
	// Operator dial for the procedural lit-window density (building-shader
	// u_windowDensity). 1.0 = tuned default (0.6 ceiling at deep night).
	// Independent of nightLightIntensity, which scales emissive BRIGHTNESS —
	// this one scales how MANY windows are lit.
	windowLightIntensity: 1.0,
	// Phase 9 (Apr-15 hash palette + Cesium API knobs productionized from
	// night-lab Variants G + H). Defaults below were tuned in the lab against
	// Hyderabad night view; operators can adjust via admin panel for on-site
	// fine-tune. The 6 shader uniforms (palette / chroma / dark void / env /
	// ambient) feed COLOR_GRADING_GLSL; the 6 scene uniforms (moonlight /
	// exposure / atmosphere / sky / viirs) drive compose.ts scene-lighting.
	// Emissive boost on lit pixels. Feb-15's value of 2.5 was paired with
	// multiple warm additive paths in the old shader (chroma boost + hash
	// variance + palette stops); the simplified single-path shader needs
	// more headroom to read as photoreal city glow. 6.0 lands at "punch"
	// without saturating to white.
	// Lowered 6.0 → 3.5: 6.0 over-amplified the city core into one hot white
	// dome (the same glow VIIRS + bloom already paint — a triple-count). 3.5
	// keeps the city reading as glow without the saturated central blowout.
	additiveStrength: 3.5,
	// Hash-palette shader terrain knobs — exposed so operators can tune
	// night ground visibility without editing GLSL. Lower darkVoid = more
	// terrain visible at night. Higher envLight = brighter ambient floor.
	darkVoidStrength: 0.15,  // was 0.3 — too aggressive, crushed terrain
	envLight: 0.8,           // was 0.5 — too dim for terrain visibility
	moonlightIntensity: 0.08,   // DirectionalLight peak intensity (full moon, deep night)
	// nightExposure 0.75: 0.50 crushed everything once the shader's warm
	// additive was lightMask-gated (the shader fix did most of the sky-
	// brightness work). 0.75 gives the scene back its dynamic range
	// while still being meaningfully dimmer than the prior 0.88.
	nightExposure: 0.75,
	// atmosphereLight 2.4: dropped 3.5 → 2.4 after user reported a
	// persistent white horizon band at night even with skyBox disabled
	// and fog floor zeroed. The analytical globe.atmosphereLightIntensity
	// produces atmospheric scattering on the globe sphere — at horizon,
	// where atmosphere depth is largest, the scattering peaks and reads
	// as a horizon band. 2.4 keeps terrain visible (the 2.0 floor warning
	// in earlier comments) while dimming the horizon scatter ~30%.
	// Natural-night pass: dropped 2.4 → 1.6. The 2.4 default lit the horizon
	// band too aggressively — combined with brShift driving the sky proper to
	// near-black (skyDarken below), it created a "black sky / bright ring at
	// horizon" stark line that read as unnatural. 1.6 softens the limb scatter
	// ~33% while still showing the atmosphere band passengers expect.
	atmosphereLight: 1.6,
	// Natural-night pass: 2.4 → 1.8. brShift now lands at -0.72 (instead of
	// -0.96 next to Cesium's -1.0 clamp). The sky retains some atmospheric
	// tint — a smooth fade into the horizon limb instead of pitch black.
	skyDarken: 1.8,
	viirsBrightness: 0.95,      // multiplier on viirsLayer.brightness (set at setup). Was 1.5 (×3.5 internal = 5.25×) which blew out CBD cores into bloom halos; 0.95 tames the harsh ground patches while keeping the city read.
	viirsAlphaBoost: 1.4,       // multiplier on viirsLayer.alpha (per-frame in syncImagery)
	// Phase 6 (altitude-gate VIIRS) — dim NASA Black Marble below cruise so
	// it doesn't compete with the building emissive at passenger-window
	// altitudes. TODO (post-Pi-perf-gate): replace with altitudeDetailMix SSOT.
	viirsAltGateLowFt: 5000,
	viirsAltGateHighFt: 15000,
	showClouds: true,
	// Phase 11c (path 1 of Earth/Sky/Pane migration): cloud billboards
	// as Cesium primitives instead of CSS3D DOM sprites. Default OFF so
	// the existing artsy DOM clouds keep shipping until the billboards
	// look right side-by-side; flip to true to test.
	useCesiumClouds: false,
	qualityMode: 'balanced' as QualityMode,
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
	// Optional wall-clock display in the playground diag/HUD overlay.
	// Off by default — operator can toggle via the playground lab's
	// extraControls panel. Lab-scope only; doesn't affect the prod kiosk.
	clockVisible: false,
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
		if (key === 'cloudDensityRange') {
			atmosphere.weather.cloudDensityRange = [...value as [number, number]];
		} else {
			(atmosphere.weather as Record<string, unknown>)[key] = value;
		}
		crdt.set(path, value);
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
