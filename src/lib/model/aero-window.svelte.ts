/**
 * AeroWindow — authoritative reactive simulation state + Svelte context DI.
 *
 * Usage:
 *   Root component: const model = createAeroWindow()
 *   Child components: const model = useAeroWindow()
 */

import { getContext, setContext, hasContext } from 'svelte';
import { clamp, getSkyState, nightFactor as nightFactorAt, dawnDuskFactor as dawnDuskFactorAt } from '$lib/utils';
import { WEATHER_EFFECTS } from '$content/weather';
import { isValidWeather, type SkyState, type LocationId, type WeatherType, type QualityMode, type DisplayMode, type SimulationContext, type VantageBeat } from '$lib/types';
import { loadPersistedState, type PersistedState } from '$lib/model/persistence';
import { pickNextLocation } from '$lib/director/scenarios';
import { LOCATIONS, LOCATION_MAP } from '$content/locations';
import { pickDailyShow } from '$content/shows';
import { applyShowOpening } from '$lib/show/load';
import { FlightSimEngine } from '$lib/camera/flight.svelte';
import { motion as motionState, motionStep } from '$lib/camera/motion.svelte';
import { directorTick, directorReset } from '$lib/director/autopilot.svelte';
import {
	config as _config,
	syncAtmosphereWeather,
	applyConfigPatch as _applyConfigPatch,
} from '$lib/model/config-tree.svelte';
import { Telemetry } from '$lib/model/telemetry.svelte';
import { isGroupLeader, resolveBinding } from '$lib/fleet/parallax.svelte';
import { createSeededRng, daySeed, hashString } from '$lib/world/prng';
// TRANSITION_DELAY_MS comes from the fleet protocol so sender + receiver share
// one number: the receiver bounds incoming schedules against it (transitionDelayMs).
import { TRANSITION_DELAY_MS, transitionDelayMs } from '$lib/fleet/protocol';


function effectiveCloudDensityFor(weather: WeatherType, raw: number, skyState: SkyState): number { const fx = WEATHER_EFFECTS[weather]; const [min, max] = fx.cloudDensityRange; let d = max > 0 ? clamp(raw, min, max) : raw * 0.3; if (skyState === 'night') d = Math.max(d * 0.5, fx.nightCloudFloor); else if (skyState === 'dusk') d *= 0.7; return d; }

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

	// True during the constructor. Boot-time config applications (persisted
	// restore, weather sync, boot setLocation jitter) must NOT stamp the CRDT
	// with the current wall-clock: an admin push issued while the Pi was
	// offline carries an OLDER timestamp and would lose LWW to a fresh
	// local-default stamp on every reboot. applyConfigPatch consults this
	// flag; genuine user/fleet interactions after boot stamp normally.
	#booting = true;

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

	// Performance. Derived from the telemetry median frame period rather than
	// counted per wall-second: at the 2–4 fps the Pi panel actually runs, a
	// per-second counter divides ~3 frames by a ~1 s window, so it lands on
	// integers only (observed: 0/2/3/5/15) and over-reports by one frame
	// (N frames span N-1 intervals). Perf work needs sub-integer resolution.
	measuredFps = $derived(this.telemetry.fps);

	// User-interaction override accessors (pauses auto-behavior for 8 s)
	get userAdjustingAltitude()   { return hasActiveOverride('altitude'); }
	get userAdjustingTime()       { return hasActiveOverride('time'); }
	get userAdjustingAtmosphere() { return hasActiveOverride('atmosphere'); }

	// qualityMode stays as a getter because CesiumModelView takes a narrowed
	// typed interface — dropping it would push the narrowing into every
	// consumer. autoQuality is gone (no more silent FPS-driven demotion).
	get qualityMode() { return this.config.world.qualityMode; }

	// High-frequency animation time (not reactive — updated each tick).
	// Read internally via #createContext to feed engines; no external consumer.
	#time = 0;

	// Private perf counters. 0 = no frame seen yet, so the first frame only
	// establishes the baseline and contributes no period sample.
	#fpsLastTime   = 0;
	// Auto-quality demotion is removed. qualityMode stays as a manual ops
	// pick via model.config.world.qualityMode — no silent FPS-driven switches
	// that fight the color-grade / bloom stages.

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

	nightFactor = $derived(nightFactorAt(this.timeOfDay));
	dawnDuskFactor = $derived(dawnDuskFactorAt(this.timeOfDay));

	// Rename alias — nightLightScale is the reactive reading used by
	// compose.ts shader uniforms. Plain getter (not $derived) because
	// wrapping a $state in $derived just adds a signal-graph node.
	get nightLightScale() { return this.config.world.nightLightIntensity; }

	effectiveCloudDensity = $derived(
		effectiveCloudDensityFor(this.weather, this.config.atmosphere.clouds.density, this.skyState),
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
		// Daily-rotation: pickDailyShow() uses daySeed() so all 3 Pis in a
		// panorama group pick the same show on a given day, and the show
		// changes each day at midnight UTC. See content/shows/index.ts.
		applyShowOpening(this, pickDailyShow());
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

		// Move the flight to the resolved boot location. applyShowOpening only
		// writes the `location` FIELD (no side-effect hooks by design), and
		// #applyPersisted moves the flight only when a location was persisted —
		// so a fresh boot orbited FlightSimEngine's class-field default (Dubai)
		// while `location` said otherwise, showing the wrong city until the
		// director's first flight (found in the Jul 8 visual A/B). Idempotent:
		// the orbit seed is deterministic per location+day, so re-syncing after
		// a persisted setLocation() recomputes the identical orbit.
		this.flight.setLocationWithSky(this.location, this.skyState);

		if (typeof window !== 'undefined') {
			this.updateTimeFromSystem();
		}

		// Boot complete — from here on, applyConfigPatch stamps the CRDT
		// with the wall-clock again (see #booting).
		this.#booting = false;
	}

	/** Sync AtmosphereConfig.weather fields from WEATHER_EFFECTS on weather change. */
	#syncWeatherConfig(): void {
		const fx = WEATHER_EFFECTS[this.weather];
		// Unstamped during boot (see #booting) — the weather recipe is a local
		// default, not a fleet decision.
		syncAtmosphereWeather(fx, this.#booting ? { stamp: false } : undefined);
	}

	#applyPersisted(saved: Partial<PersistedState>): void {
		if (saved.location) this.setLocation(saved.location);
		if (saved.altitude !== undefined) this.flight.altitude = saved.altitude;
		if (saved.weather) { this.weather = saved.weather; this.#syncWeatherConfig(); }
		// Config-tree restores go through applyConfigPatch so the same
		// validation/type gates apply, but WITHOUT a CRDT stamp (#booting) —
		// an admin push issued while the Pi was offline carries an older
		// wall-clock timestamp and must still win LWW over these restored
		// local defaults.
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
		// Deterministic jitter — same daySeed() ^ location-hash seed as the
		// orbit (flight.setLocationWithSky). All 3 Pis in a panorama compute
		// IDENTICAL cloud/haze settings on arrival, so the seam stays aligned
		// and the peer-synced writes converge instead of fighting via LWW.
		// Was Math.random(): each Pi jittered independently per pane.
		const rng = createSeededRng((daySeed() ^ hashString(id)) >>> 0);
		const jitter = (base: number, amp: number, lo: number, hi: number) =>
			clamp(base + (rng() - 0.5) * amp, lo, hi);
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

	// ── Night-city flyover beat ─────────────────────────────────────────────
	// enter/exit are the atomic edges; scheduleFlyover locks BOTH edges to a
	// shared wall-clock instant so the leader and all followers pitch down and
	// pop back at the same moment (no panorama tear). The leader schedules from
	// its tick; each follower schedules from the fleet client's vantage_beat
	// handler with the SAME transitionAtMs. Pending timers are cancelled on any
	// location change and on destroy.
	#flyoverTimers = new Set<ReturnType<typeof setTimeout>>();

	enterFlyover(pitchDeg: number, altitudeFt: number): void {
		this.applyConfigPatch('camera.flyoverPitchDeg', pitchDeg);   // CRDT-stamped so peer Pis see the flyover
		this.flight.setFlyoverAltitude(Math.max(altitudeFt, this.config.camera.altitude.min));
	}

	exitFlyover(): void {
		for (const id of this.#flyoverTimers) clearTimeout(id);
		this.#flyoverTimers.clear();
		this.applyConfigPatch('camera.flyoverPitchDeg', 0);
		this.flight.clearFlyoverAltitude();
	}

	/** Schedule enter@transitionAtMs and exit@transitionAtMs+durationMs. Called
	 *  by the leader (tick) and every follower (fleet client) with the same
	 *  transitionAtMs → all Pis lock-step. Cancels any beat already pending. */
	scheduleFlyover(beat: VantageBeat, transitionAtMs: number): void {
		this.exitFlyover();   // cancel any in-flight beat + its timers first
		// Clamped for the same reason as director_decision: a peer with a bad
		// clock must not freeze the beat for hours or overflow setTimeout into
		// firing instantly. transitionDelayMs is the shared bound.
		const enterDelay = transitionDelayMs(transitionAtMs);
		const enterId = setTimeout(() => {
			this.#flyoverTimers.delete(enterId);
			this.enterFlyover(beat.pitchDeg, beat.altitudeFt);
			const exitId = setTimeout(() => {
				this.#flyoverTimers.delete(exitId);
				this.exitFlyover();
			}, beat.durationMs);
			this.#flyoverTimers.add(exitId);
		}, enterDelay);
		this.#flyoverTimers.add(enterId);
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
		return pickNextLocation(this.location, this.timeOfDay, {
			nightLitOnly: this.config.director.autopilot.nightLitCitiesOnly,
		});
	}

	/**
	 * Human / ops scene change (blind pull, LocationPicker).
	 *
	 * Leaders only: broadcast `director_decision` then fly locally (same
	 * contract as the autopilot path). Edge followers ignore — they only
	 * move when a `director_decision` arrives via the fleet client and
	 * `applyScene()` runs. Without this gate a center blind-pull desynced
	 * the corridor (one pane cruised; left/right stayed in orbit).
	 */
	flyTo(locationId: LocationId): void {
		if (!isGroupLeader(this.config.camera.parallax.role)) {
			this.telemetry.recordEvent('info', {
				event: 'flyTo_ignored',
				reason: 'follower',
				locationId,
				role: this.config.camera.parallax.role,
			});
			return;
		}
		this.#broadcastLocationDecision(locationId, 'manual');
		this.flight.flyTo(locationId, this.skyState);
	}

	/**
	 * Fan-out a location change to corridor peers. Shared by autopilot and
	 * human flyTo so the wire shape cannot drift between the two paths.
	 */
	#broadcastLocationDecision(locationId: LocationId, scenarioId: string): void {
		if (!this.#fleetBroadcast) return;
		if (!isGroupLeader(this.config.camera.parallax.role)) return;
		const now = Date.now();
		this.#fleetBroadcast({
			v: 2,
			type: 'director_decision',
			scenarioId,
			locationId,
			weather: this.weather,
			decidedAtMs: now,
			transitionAtMs: now + TRANSITION_DELAY_MS,
			groupId: resolveBinding().groupId,
		});
	}

	setDisplayMode(mode: DisplayMode, payload?: string): void {
		this.displayMode = mode;
		if (payload && mode === 'video') this.videoUrl = payload;
	}

	applyScene(locationId: LocationId, weather?: WeatherType): void {
		this.exitFlyover();   // a location change ends any active flyover beat
		this.flight.flyTo(locationId, this.skyState);
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
		// Boot-time applications skip the CRDT stamp (see #booting).
		return _applyConfigPatch(path, value, this.#booting ? { stamp: false } : undefined);
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

		// Refresh heading/lat/lon AFTER flight.tick() so motionStep sees current values.
		// flight.tick() needs ctx for camera/orbit config reads, but mutates heading/lat/lon.
		ctx.heading = this.flight.heading;
		ctx.lat    = this.flight.lat;
		ctx.lon    = this.flight.lon;

		motionStep(delta, ctx);

		ctx.isOrbitMode      = this.flight.flightMode === 'orbit';
		ctx.pickNextLocation = () => this.pickNextLocation();
		// Phase 7 — solo + center are leaders (run autopilot); left/right follow
		// the leader's director_decision. The rule lives in fleet/parallax as
		// isGroupLeader: it was ALSO inlined here, so the panorama's leader
		// definition existed in two places. If they ever disagreed, two Pis
		// would both run the autopilot and fight over the location, or none
		// would and the wall would freeze on one scene.
		ctx.isLeader = isGroupLeader(this.config.camera.parallax.role);
		const directorPatch = directorTick(delta, ctx);

		if (directorPatch.configs) {
			for (const { path, value } of directorPatch.configs) {
				if (path === 'weather') this.setWeather(value as WeatherType);
				else this.applyConfigPatch(path, value);
			}
		}
		if (directorPatch.nextLocation) {
			// A new location cancels any active/pending flyover beat — the
			// world is moving, so pop the camera back to the normal look.
			this.exitFlyover();
			// Phase 7 — broadcast BEFORE flying locally (shared with flyTo()).
			// transitionAtMs is 2.5s ahead so followers can lock to wall-clock
			// and absorb ~±200 ms NTP drift. Leader still starts immediately
			// (same as pre-existing autopilot contract).
			this.#broadcastLocationDecision(directorPatch.nextLocation, 'autopilot');
			this.flight.flyTo(directorPatch.nextLocation, this.skyState);
		} else if (directorPatch.vantageBeat) {
			// Leader chose a night-city flyover. Broadcast the same transitionAtMs
			// to followers, then schedule locally off that instant so every Pi
			// enters and exits in lock-step (single broadcast, both edges).
			const now = Date.now();
			const transitionAtMs = now + TRANSITION_DELAY_MS;
			if (ctx.isLeader && this.#fleetBroadcast) {
				this.#fleetBroadcast({
					v: 2,
					type: 'vantage_beat',
					decidedAtMs: now,
					transitionAtMs,
					durationMs: directorPatch.vantageBeat.durationMs,
					pitchDeg: directorPatch.vantageBeat.pitchDeg,
					altitudeFt: directorPatch.vantageBeat.altitudeFt,
					groupId: resolveBinding().groupId,
				});
			}
			this.scheduleFlyover(directorPatch.vantageBeat, transitionAtMs);
		}

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
		return c;
	}

	// Feed the real, *unclamped* wall-clock gap between frames to telemetry.
	// The game loop clamps its `dt` to 100 ms so the simulation stays stable
	// through a stall — using that clamped value here would pin every reading
	// below 10 fps at exactly 10 fps.
	#reportFrame(now: number): void {
		if (this.#fpsLastTime > 0) {
			this.telemetry.recordFramePeriod(now - this.#fpsLastTime);
		}
		this.#fpsLastTime = now;
	}

	destroy(): void {
		// override timestamps are module-level — nothing to teardown there.
		this.exitFlyover();   // cancel any pending flyover enter/exit timers
	}
}

// ─── Context DI ──────────────────────────────────────────────────────────────
//
// Hand-rolled over `createContext()` for ONE reason: createContext's getter
// THROWS `missing_context` when unset, with no non-throwing companion and no
// way to reach its private key. `tryUseAeroWindow()` must be able to answer
// "is there a model?" with `null`, because AtmosphereControls / LightingControls
// mount both inside the kiosk tree and standalone in /admin. Owning the key
// here lets `hasContext` do that check safely.
const AERO_WINDOW_KEY = Symbol('aero-window');

function getAeroWindowContext(): AeroWindow {
	return getContext<AeroWindow>(AERO_WINDOW_KEY);
}

export function createAeroWindow(): AeroWindow {
	const model = new AeroWindow();
	setContext(AERO_WINDOW_KEY, model);
	return model;
}

export function useAeroWindow(): AeroWindow {
	if (!hasContext(AERO_WINDOW_KEY)) {
		throw new Error('useAeroWindow() called outside component tree');
	}
	return getAeroWindowContext();
}

/**
 * Non-throwing variant for components mountable both inside the kiosk
 * tree (model present) and standalone in /admin (no AeroWindow context —
 * admin writes go through the module-level config gate instead, and
 * startPeerSync propagates them to the fleet).
 *
 * ─── ⚠ WHY THIS USES hasContext RATHER THAN `?? null` ───────────────────────
 * `createContext()`'s getter does not return undefined when the context is
 * unset — it THROWS `missing_context`. So the previous `getAeroWindowContext()
 * ?? null` could never yield null: the ?? was dead code, and mounting any of
 * these components without a provider killed the whole page during init.
 * That is what blanked /admin — a white screen with one console error, while
 * `bun run check` and every unit test stayed green.
 *
 * `hasContext` is the only safe pre-check, and it must be called with the SAME
 * key the getter uses, which is why the key lives here beside the accessors
 * rather than being hidden inside createContext's closure.
 */
export function tryUseAeroWindow(): AeroWindow | null {
	return hasContext(AERO_WINDOW_KEY) ? getAeroWindowContext() : null;
}
