/**
 * AeroWindow — authoritative reactive simulation state + Svelte context DI.
 *
 * Usage:
 *   Root component: const model = createAeroWindow()
 *   Child components: const model = useAeroWindow()
 */

import { createContext } from 'svelte';
import { clamp, getSkyState, nightFactor, dawnDuskFactor } from '$lib/utils';
import { WEATHER_EFFECTS } from '$lib/constants';
import { isValidWeather, type SkyState, type LocationId, type WeatherType, type QualityMode, type DisplayMode, type SimulationContext } from '$lib/types';
import { effectiveCloudDensity } from '$lib/atmosphere/clouds/rules';
import { nextQualityMode } from '$lib/world/auto-quality';
import { loadPersistedState, type PersistedState } from '$lib/model/aero-window-persistence';
import { pickNextLocation } from '$lib/director/scenarios';
import { LOCATIONS, LOCATION_MAP } from '$lib/locations';
import { FlightSimEngine } from '$lib/camera/flight.svelte';
import { motion as motionState, motionStep } from '$lib/camera/motion.svelte';
import { directorTick, directorReset } from '$lib/director/autopilot.svelte';
import {
	config as _config,
	syncAtmosphereWeather,
	applyConfigPatch as _applyConfigPatch,
} from '$lib/model/config-tree.svelte';
import { Telemetry } from '$lib/model/frame-telemetry.svelte';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AeroWindowPatch {
	altitude: number;
	timeOfDay: number;
	weather: WeatherType;
	cloudDensity: number;
	cloudSpeed: number;
	haze: number;
	nightLightIntensity: number;
	flightSpeed: number;
	syncToRealTime: boolean;
	showClouds: boolean;
	showBuildings?: boolean;
}

// ─── User override state ──────────────────────────────────────────────────────

/** Expiry timestamps (performance.now()) per override kind. 0 = inactive. */
const OVERRIDE_COOLDOWN_MS = 8000;
const _overrides = $state({ altitude: 0, time: 0, atmosphere: 0 });

export function trackOverride(kind: keyof typeof _overrides): void {
	_overrides[kind] = performance.now() + OVERRIDE_COOLDOWN_MS;
}

export function hasActiveOverride(kind: keyof typeof _overrides): boolean {
	return performance.now() < _overrides[kind];
}

// ─── AeroWindow ──────────────────────────────────────────────────────────────

export class AeroWindow {
	// ── Engines ───────────────────────────────────────────────────────────────
	// flight is the only remaining class (public methods called outside
	// tick, in-class $derived for cruise state). motion + director are
	// modules of pure functions with state in module scope. `model.motion`
	// is a getter returning the module's singleton state object — keeps
	// existing `model.motion.*` call sites untouched across Window.svelte
	// and compose.ts.
	readonly flight = new FlightSimEngine();
	get motion() { return motionState; }

	// ── Config tree ──────────────────────────────────────────────────────────
	// Flat reactive config — single-file state with generic path dispatcher.
	// Fleet v2 config_patch messages route through applyConfigPatch(path, value).
	readonly config = _config;

	// ── Observability (Phase 5.6) ────────────────────────────────────────────
	// Ring-buffer telemetry — per-frame durations (p50/p95), lifecycle events,
	// counters. Instrumentation batches so the 60 Hz tick path only touches a
	// plain non-reactive buffer. Surfaced to UI via TelemetryPanel (Shift+T).
	readonly telemetry = new Telemetry();

	// Phase 7 — leader broadcast hook. Set by the fleet client on connect
	// (see setFleetBroadcast). When this device is a panorama leader, the
	// director calls this hook to notify followers of scenario changes so
	// all three Pis flip to the same location at the same wall-clock
	// instant (via the transitionAtMs schedule on the receiver side).
	#fleetBroadcast: ((msg: { v: 2; type: string; [k: string]: unknown }) => void) | null = null;
	setFleetBroadcast(fn: ((msg: { v: 2; type: string; [k: string]: unknown }) => void) | null): void {
		this.#fleetBroadcast = fn;
	}

	// ── Core state ────────────────────────────────────────────────────────────
	location     = $state<LocationId>('dubai');
	timeOfDay    = $state(12);
	syncToRealTime = $state(true);

	// Environment
	weather = $state<WeatherType>('cloudy');

	// Display — fleet-controlled mode. Stored and relayed via fleet status/push.
	// Window.svelte does not consume this yet; add a display-path consumer here
	// when screensaver/video modes are implemented. Plain fields (not $state):
	// only read by setInterval-driven fleet status push — never in a template.
	displayMode: DisplayMode = 'flight';
	videoUrl    = '';

	// Performance (delegated to world config — single source of truth)
	measuredFps = $state(0);

	// User-interaction override accessors (pauses auto-behavior for 8 s)
	get userAdjustingAltitude()   { return hasActiveOverride('altitude'); }
	get userAdjustingTime()       { return hasActiveOverride('time'); }
	get userAdjustingAtmosphere() { return hasActiveOverride('atmosphere'); }

	// qualityMode/autoQuality stay as getters because CesiumModelView takes
	// a narrowed typed interface — dropping them would push the narrowing
	// into every consumer. The other four (blindOpen / showClouds /
	// showBuildings / haze) were pure delegation and are gone; read
	// `model.config.*` directly instead.
	get qualityMode() { return this.config.world.qualityMode; }
	get autoQuality() { return this.config.world.autoQuality; }

	// High-frequency animation time (not reactive — updated via untrack in game loop)
	time = 0;

	// Private perf counters
	#frameCount    = 0;
	#fpsLastTime   = 0;
	#qualityCheckTimer = 0;

	// ── Derived ───────────────────────────────────────────────────────────────
	currentLocation = $derived(LOCATION_MAP.get(this.location) ?? LOCATIONS[0]);
	localTimeOfDay = $derived.by(() => {
		const offset = this.currentLocation.utcOffset;
		let lt = this.timeOfDay + offset;
		if (lt >= 24) lt -= 24;
		if (lt < 0) lt += 24;
		return lt;
	});

	skyState = $derived<SkyState>(getSkyState(this.timeOfDay));

	sceneFog = $derived(this.currentLocation.scene.fog);
	terrainExaggeration = $derived(this.currentLocation.scene.terrain.exaggeration);

	nightFactor = $derived(nightFactor(this.timeOfDay));
	dawnDuskFactor = $derived(dawnDuskFactor(this.timeOfDay));

	// Rename alias — nightLightScale is the reactive reading used by
	// compose.ts shader uniforms. Plain getter (not $derived) because
	// wrapping a $state in $derived just adds a signal-graph node.
	get nightLightScale() { return this.config.world.nightLightIntensity; }

	effectiveCloudDensity = $derived(
		effectiveCloudDensity(this.weather, this.config.atmosphere.clouds.density, this.skyState),
	);

	// ── Constructor ───────────────────────────────────────────────────────────
	constructor() {
		this.#applyPersisted(loadPersistedState());
		this.#syncWeatherConfig();

		if (typeof window !== 'undefined') {
			this.#fpsLastTime = performance.now();
			const now = new Date();
			this.timeOfDay = now.getHours() + now.getMinutes() / 60;
		}
	}

	/** Sync AtmosphereConfig.weather fields from WEATHER_EFFECTS on weather change. */
	#syncWeatherConfig(): void {
		const fx = WEATHER_EFFECTS[this.weather];
		syncAtmosphereWeather(fx);
	}

	#applyPersisted(saved: Partial<PersistedState>): void {
		if (saved.location) this.setLocation(saved.location);
		if (saved.altitude !== undefined) this.flight.altitude = saved.altitude;
		if (saved.weather) { this.weather = saved.weather; this.#syncWeatherConfig(); }
		if (saved.cloudDensity !== undefined) this.config.atmosphere.clouds.density = saved.cloudDensity;
		if (saved.buildingsEnabled !== undefined) this.config.world.buildingsEnabled = saved.buildingsEnabled;
		if (saved.showClouds !== undefined) this.config.world.showClouds = saved.showClouds;
		this.syncToRealTime = saved.syncToRealTime ?? true;
	}

	// ── Actions ───────────────────────────────────────────────────────────────

		setLocation(id: LocationId): void {
		this.location = id;
		this.flight.setLocationWithSky(id, this.skyState);
		const scene = this.currentLocation.scene;
		const jitter = (base: number, amp: number, lo: number, hi: number) =>
			clamp(base + (Math.random() - 0.5) * amp, lo, hi);
		this.config.atmosphere.clouds.density = jitter(scene.clouds.density, 0.24, 0.1, 1.0);
		this.config.atmosphere.clouds.speed = jitter(scene.clouds.speed, 0.24, 0.2, 1.6);
		this.config.atmosphere.haze.amount = jitter(this.config.atmosphere.haze.amount, 0.03, 0, 0.18);
	}

	setAltitude(alt: number): void {
		const { min, max } = this.config.camera.altitude;
		this.flight.setAltitude(alt, { min, max });
		this.onUserInteraction('altitude');
	}

	setTime(t: number): void {
		this.timeOfDay = clamp(t, 0, 24);
		this.onUserInteraction('time');
	}

	setWeather(w: WeatherType): void {
		if (!isValidWeather(w)) return;
		this.weather = w;
		this.#syncWeatherConfig();
		this.onUserInteraction('atmosphere');
	}

	setFlightSpeed(n: number): void {
		this.flight.flightSpeed = clamp(n, 0.1, 5);
	}

	updateTimeFromSystem(): void {
		const now = new Date();
		this.timeOfDay = now.getHours() + now.getMinutes() / 60;
	}

	pickNextLocation(): LocationId {
		return pickNextLocation(this.location, this.timeOfDay);
	}

	flyTo(locationId: LocationId): void {
		this.flight.flyTo(locationId);
	}

	setDisplayMode(mode: DisplayMode, payload?: string): void {
		this.displayMode = mode;
		if (payload && mode === 'video') this.videoUrl = payload;
	}

	applyScene(locationId: LocationId, weather?: WeatherType): void {
		this.flight.flyTo(locationId);
		if (weather) { this.weather = weather; this.#syncWeatherConfig(); }
	}

	setQualityMode(mode: QualityMode): void {
		this.config.world.qualityMode = mode;
	}

	/**
	 * Path-targeted config patch. Routes into the flat config tree via
	 * the generic dispatcher. Returns true if the path was recognised.
	 * Called by the fleet v2 `config_patch` message handler.
	 */
	applyConfigPatch(path: string, value: unknown): boolean {
		this.telemetry.recordEvent('config_patch', { path, value });
		return _applyConfigPatch(path, value);
	}

	/**
	 * Flat-DTO adapter. NOT a parallel writer — every field delegates to a
	 * typed setter (for behaviours that need side effects like bounds clamp
	 * or user-interaction tracking) or to applyConfigPatch (for pure config
	 * tree values). Two callers remain: (a) director returns AtmospherePatch
	 * through this adapter; (b) fleet v1 `set_config` handler until admin
	 * panel migrates to v2 path patches.
	 *
	 * Direct panel callers (WeatherPicker, TimeControl, FlightControls)
	 * should use the typed setters instead.
	 */
	applyPatch(patch: Partial<AeroWindowPatch>): void {
		if (patch.altitude !== undefined)            this.setAltitude(patch.altitude);
		if (patch.timeOfDay !== undefined)           this.setTime(patch.timeOfDay);
		if (patch.weather !== undefined)             this.setWeather(patch.weather as WeatherType);
		if (patch.flightSpeed !== undefined)         this.setFlightSpeed(patch.flightSpeed);
		if (patch.syncToRealTime !== undefined && typeof patch.syncToRealTime === 'boolean') {
			this.syncToRealTime = patch.syncToRealTime;
		}
		if (patch.cloudDensity !== undefined) {
			this.applyConfigPatch('atmosphere.clouds.density', clamp(patch.cloudDensity, 0, 1));
			this.onUserInteraction('atmosphere');
		}
		if (patch.cloudSpeed !== undefined)          this.applyConfigPatch('atmosphere.clouds.speed', clamp(patch.cloudSpeed, 0, 2));
		if (patch.haze !== undefined)                this.applyConfigPatch('atmosphere.haze.amount', clamp(patch.haze, 0, 0.2));
		if (patch.nightLightIntensity !== undefined) this.applyConfigPatch('world.nightLightIntensity', clamp(patch.nightLightIntensity, 0, 5));
		if (patch.showClouds !== undefined && typeof patch.showClouds === 'boolean') {
			this.applyConfigPatch('world.showClouds', patch.showClouds);
		}
		if (patch.showBuildings !== undefined && typeof patch.showBuildings === 'boolean') {
			this.applyConfigPatch('world.buildingsEnabled', patch.showBuildings);
		}
	}

	onUserInteraction(type: 'altitude' | 'time' | 'atmosphere'): void {
		trackOverride(type);
	}

	getPersistedSnapshot(): PersistedState {
		return {
			location: this.location, altitude: this.flight.altitude, weather: this.weather,
			cloudDensity: this.config.atmosphere.clouds.density,
			buildingsEnabled: this.config.world.buildingsEnabled,
			showClouds: this.config.world.showClouds, syncToRealTime: this.syncToRealTime,
		};
	}

	reportFrame(): void {
		this.#frameCount++;
		const now = performance.now();
		const elapsed = now - this.#fpsLastTime;
		if (elapsed >= 1000) {
			this.measuredFps = Math.round((this.#frameCount * 1000) / elapsed);
			this.#frameCount = 0;
			this.#fpsLastTime = now;
		}
	}

	// ── Tick pipeline ─────────────────────────────────────────────────────────

	tick(delta: number): void {
		if (!Number.isFinite(delta) || delta <= 0 || delta > 0.1) return;
		const frameStart = performance.now();
		this.time = (this.time + delta) % 3600;

		const ctx = this.#createContext();

		const flightPatch = this.flight.tick(delta, ctx);
		if (flightPatch.blindOpen !== undefined) this.config.shell.blindOpen = flightPatch.blindOpen;
		if (flightPatch.locationArrived)         this.setLocation(flightPatch.locationArrived);
		if (flightPatch.resetDirector)           directorReset(ctx);

		motionStep(delta, ctx);

		ctx.isOrbitMode      = this.flight.flightMode === 'orbit';
		ctx.pickNextLocation = () => pickNextLocation(this.location, this.timeOfDay);
		// Phase 7 — solo + center are leaders (run autopilot). left + right
		// are followers (wait for director_decision from leader).
		const role = this.config.camera.parallax.role;
		ctx.isLeader = role === 'solo' || role === 'center';
		const directorPatch = directorTick(delta, ctx);

		if (directorPatch.atmosphere) this.applyPatch(directorPatch.atmosphere);
		if (directorPatch.nextLocation) {
			// Phase 7 — if we're a panorama leader with connected followers,
			// broadcast the decision BEFORE flying locally. transitionAtMs is
			// 2.5s in the future so all three Pis can lock to the same wall-
			// clock instant and start cruise_departure simultaneously,
			// absorbing NTP drift (up to ±200ms is safe).
			if (ctx.isLeader && this.#fleetBroadcast) {
				const now = Date.now();
				this.#fleetBroadcast({
					v: 2,
					type: 'director_decision',
					scenarioId: 'autopilot',
					locationId: directorPatch.nextLocation,
					weather: this.weather,
					decidedAtMs: now,
					transitionAtMs: now + 2500,
				});
			}
			this.flight.flyTo(directorPatch.nextLocation);
		}

		if (this.autoQuality) this.#tickAutoQuality(delta);

		this.telemetry.recordFrame(performance.now() - frameStart);
	}

	// Reuse a single context object each frame — avoids per-frame GC pressure
	#ctx: SimulationContext = {
		time: 0, lat: 0, lon: 0, altitude: 0, heading: 0, pitch: 0, bankAngle: 0,
		weather: 'cloudy', skyState: 'day', nightFactor: 0, dawnDuskFactor: 0,
		locationId: 'dubai', userAdjustingAltitude: false, userAdjustingTime: false,
		userAdjustingAtmosphere: false, cloudDensity: 0, cloudSpeed: 0, haze: 0,
		turbulenceLevel: 'light',
		camera: _config.camera,
		director: _config.director,
	};

	#createContext(): SimulationContext {
		const c = this.#ctx;
		c.time                  = this.time;
		c.lat                   = this.flight.lat;
		c.lon                   = this.flight.lon;
		c.altitude              = this.flight.altitude;
		c.heading               = this.flight.heading;
		c.pitch                 = this.flight.pitch;
		c.bankAngle             = this.motion.bankAngle;
		c.weather               = this.weather;
		c.skyState              = this.skyState;
		c.nightFactor           = this.nightFactor;
		c.dawnDuskFactor        = this.dawnDuskFactor;
		c.locationId            = this.location;
		c.userAdjustingAltitude = this.userAdjustingAltitude;
		c.userAdjustingTime     = this.userAdjustingTime;
		c.userAdjustingAtmosphere = this.userAdjustingAtmosphere;
		c.cloudDensity = this.config.atmosphere.clouds.density;
		c.cloudSpeed   = this.config.atmosphere.clouds.speed;
		c.haze         = this.config.atmosphere.haze.amount;
		c.turbulenceLevel       = WEATHER_EFFECTS[this.weather].turbulence;
		c.camera                = _config.camera;
		c.director              = _config.director;
		return c;
	}

	#tickAutoQuality(delta: number): void {
		if (this.measuredFps === 0) return;
		this.#qualityCheckTimer += delta;
		if (this.#qualityCheckTimer < 5) return;
		this.#qualityCheckTimer = 0;
		this.config.world.qualityMode = nextQualityMode(this.measuredFps, this.config.world.qualityMode);
	}

	destroy(): void {
		// override timestamps are module-level — nothing to teardown
	}
}

// ─── Context DI ──────────────────────────────────────────────────────────────
//
// createContext (Svelte 5.40+) provides type-safe get/set without a manual
// Symbol key or cast. The returned tuple's set/get names stay private inside
// this module; public API is createAeroWindow() / useAeroWindow().
const [getAeroWindowContext, setAeroWindowContext] = createContext<AeroWindow>();

export function createAeroWindow(): AeroWindow {
	const model = new AeroWindow();
	setAeroWindowContext(model);
	return model;
}

export function useAeroWindow(): AeroWindow {
	const model = getAeroWindowContext();
	if (!model) throw new Error('useAeroWindow() called outside component tree');
	return model;
}
