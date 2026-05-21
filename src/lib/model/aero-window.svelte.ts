/**
 * AeroWindow — authoritative reactive simulation state + Svelte context DI.
 *
 * Usage:
 *   Root component: const model = createAeroWindow()
 *   Child components: const model = useAeroWindow()
 */

import { createContext } from 'svelte';
import { clamp, getSkyState, nightFactor, dawnDuskFactor } from '$lib/utils';
import { WEATHER_EFFECTS } from '$content/weather';
import { isValidWeather, type SkyState, type LocationId, type WeatherType, type QualityMode, type DisplayMode, type SimulationContext } from '$lib/types';
import { effectiveCloudDensity } from '$lib/scene/effects/clouds';
import { nextQualityMode } from '$lib/model/config-tree.svelte';
import { loadPersistedState, type PersistedState } from '$lib/model/aero-window-persistence';
import { pickNextLocation } from '$lib/director/scenarios';
import { LOCATIONS, LOCATION_MAP } from '$content/locations';
import { defaultShow } from '$content/shows/default.show';
import { applyShowOpening } from '$lib/show/load';
import { FlightSimEngine } from '$lib/camera/flight.svelte';
import { motion as motionState, motionStep } from '$lib/camera/motion.svelte';
import { directorTick, directorReset } from '$lib/director/autopilot.svelte';
import {
	config as _config,
	syncAtmosphereWeather,
	applyConfigPatch as _applyConfigPatch,
} from '$lib/model/config-tree.svelte';
import { Telemetry } from '$lib/model/frame-telemetry.svelte';

const TRANSITION_DELAY_MS = 2500;

// ─── User override state ──────────────────────────────────────────────────────

/** Expiry timestamps (performance.now()) per override kind. 0 = inactive. */
const OVERRIDE_COOLDOWN_MS = 8000;
const _overrides = $state({ altitude: 0, time: 0, atmosphere: 0 });

function trackOverride(kind: keyof typeof _overrides): void {
	_overrides[kind] = performance.now() + OVERRIDE_COOLDOWN_MS;
}

function hasActiveOverride(kind: keyof typeof _overrides): boolean {
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
	location     = $state<LocationId>('hyderabad');
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

	// High-frequency animation time (not reactive — updated each tick).
	// Read internally via #createContext to feed engines; no external consumer.
	#time = 0;

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
		// Precedence at boot:
		//   1. Show opening (baseline — from $content/shows/default.show.ts)
		//   2. Persisted localStorage (user's last session, wins over show)
		//   3. Dev-mode night override (only if no persisted state AND import.meta.env.DEV)
		//   4. Real-time wall-clock (if syncToRealTime, overrides timeOfDay
		//      to current wall-clock below)
		// URL params and admin pushes come later in the page lifecycle.
		applyShowOpening(this, defaultShow);
		const persisted = loadPersistedState();
		this.#applyPersisted(persisted);
		this.#syncWeatherConfig();

		// Dev-mode: when iterating in `bun run dev` with nothing persisted yet,
		// default to deep night (22:00) instead of the show's dawn opening, so
		// the night-light pipeline (VIIRS / shader / warm glow) is visible by
		// default while developing. Production install ships with the show's
		// dawn opening; this branch is gated on import.meta.env.DEV so it never
		// reaches the Pi.
		if (
			typeof window !== 'undefined'
			&& import.meta.env.DEV
			&& Object.keys(persisted).length === 0
		) {
			this.syncToRealTime = false;
			this.timeOfDay = 22;
		}

		if (typeof window !== 'undefined') {
			this.#fpsLastTime = performance.now();
			this.updateTimeFromSystem();
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
		// Config-tree restores go through applyConfigPatch so the CRDT timestamp
		// index reflects the restored value — keeps the LWW comparison honest
		// when an admin push lands milliseconds later.
		if (saved.cloudDensity !== undefined) this.applyConfigPatch('atmosphere.clouds.density', saved.cloudDensity);
		if (saved.buildingsEnabled !== undefined) this.applyConfigPatch('world.buildingsEnabled', saved.buildingsEnabled);
		if (saved.showClouds !== undefined) this.applyConfigPatch('world.showClouds', saved.showClouds);
		this.syncToRealTime = saved.syncToRealTime ?? true;
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	setLocation(id: LocationId): void {
		this.location = id;
		this.flight.setLocationWithSky(id, this.skyState);
		const scene = this.currentLocation.scene;
		const jitter = (base: number, amp: number, lo: number, hi: number) =>
			clamp(base + (Math.random() - 0.5) * amp, lo, hi);
		// Route through applyConfigPatch so the CRDT stamps the writer + the
		// new value lands in the timestamp index. Earlier this wrote
		// config.atmosphere.* directly, which propagated to peers via the
		// peer-sync $effect but left the originator's CRDT timestamp stale —
		// any subsequent admin push (with timestamp > 0) would silently win.
		this.applyConfigPatch('atmosphere.clouds.density', jitter(scene.clouds.density, 0.24, 0.1, 1.0));
		this.applyConfigPatch('atmosphere.clouds.speed', jitter(scene.clouds.speed, 0.24, 0.2, 1.6));
		this.applyConfigPatch('atmosphere.haze.amount', jitter(this.config.atmosphere.haze.amount, 0.03, 0, 0.18));
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
		// Honor the cruise bounds defined in the config tree (admin-tunable
		// SSOT). Earlier this hard-coded (0.1, 5) which contradicted the
		// admin UI's slider max of 3.0 — fleet PATCHes could land speeds
		// above the slider ceiling. The warp transient in
		// flight.svelte.ts:#tickDeparture still bypasses this clamp
		// (sets ~100x during the 2 s departure burst), which is intentional.
		const { minSpeed, maxSpeed } = this.config.camera.cruise;
		this.flight.flightSpeed = clamp(n, minSpeed, maxSpeed);
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
		this.applyConfigPatch('world.qualityMode', mode);
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

	// ── Tick pipeline ─────────────────────────────────────────────────────────

	tick(delta: number): void {
		if (!Number.isFinite(delta) || delta <= 0 || delta > 0.1) return;
		const frameStart = performance.now();
		this.#time = (this.#time + delta) % 3600;
		this.#reportFrame(frameStart);

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

		if (directorPatch.configs) {
			for (const { path, value } of directorPatch.configs) {
				if (path === 'weather') this.setWeather(value as WeatherType);
				else this.applyConfigPatch(path, value);
			}
		}
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
					transitionAtMs: now + TRANSITION_DELAY_MS,
				});
			}
			this.flight.flyTo(directorPatch.nextLocation);
		}

		if (this.config.world.autoQuality) this.#tickAutoQuality(delta);

		this.telemetry.recordFrame(performance.now() - frameStart);
	}

	// Reuse a single context object each frame — avoids per-frame GC pressure
	#ctx: SimulationContext = {
		time: 0, lat: 0, lon: 0, altitude: 0, heading: 0, pitch: 0, bankAngle: 0,
		weather: 'cloudy', skyState: 'day', nightFactor: 0, dawnDuskFactor: 0,
		locationId: 'hyderabad', userAdjustingAltitude: false, userAdjustingTime: false,
		userAdjustingAtmosphere: false, cloudDensity: 0, cloudSpeed: 0, haze: 0,
		warpFactor: 0,
		turbulenceLevel: 'light',
		camera: _config.camera,
		director: _config.director,
	};

	#createContext(): SimulationContext {
		const c = this.#ctx;
		c.time                  = this.#time;
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
		c.warpFactor   = this.flight.warpFactor;
		c.turbulenceLevel       = WEATHER_EFFECTS[this.weather].turbulence;
		c.camera                = _config.camera;
		c.director              = _config.director;
		return c;
	}

	#reportFrame(now: number): void {
		this.#frameCount++;
		const elapsed = now - this.#fpsLastTime;
		if (elapsed >= 1000) {
			this.measuredFps = Math.round((this.#frameCount * 1000) / elapsed);
			this.#frameCount = 0;
			this.#fpsLastTime = now;
		}
	}

	#tickAutoQuality(delta: number): void {
		if (this.measuredFps === 0) return;
		this.#qualityCheckTimer += delta;
		if (this.#qualityCheckTimer < 5) return;
		this.#qualityCheckTimer = 0;
		const next = nextQualityMode(this.measuredFps, this.config.world.qualityMode);
		if (next !== this.config.world.qualityMode) {
			this.applyConfigPatch('world.qualityMode', next);
		}
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
