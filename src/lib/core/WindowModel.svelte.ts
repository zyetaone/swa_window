/**
 * WindowModel - Single Source of Truth
 *
 * All authoritative state lives here. Components derive from this.
 * No callbacks, no bidirectional sync, no duplicate state.
 *
 * Architecture:
 * - $state: Mutable fields (position, time, weather, flags)
 * - $derived: Pure computations (skyState, cloud density, altitude targets)
 * - Actions: Methods that validate + update state
 * - tick(dt): Single animation update for all time-based state
 * - flyTo(): Synchronous state transition to cruise mode
 */

import { clamp } from '$lib/shared/utils';
import { AIRCRAFT, WEATHER_EFFECTS } from '$lib/shared/constants';
import type { SkyState, LocationId, WeatherType } from '$lib/shared/types';
import type { DisplayMode, DisplayConfig } from '$lib/shared/protocol';
import type { QualityMode } from '$lib/shared/constants';
// re-export for consumers
export type { QualityMode };
import { LOCATIONS, LOCATION_MAP } from '$lib/shared/locations';
import { loadPersistedState, safeNum, type PersistedState } from '$lib/shared/persistence';
import { FlightSimEngine } from '$lib/engine/FlightSim.svelte';
import { MotionEngine } from '$lib/engine/Motion.svelte';
import { EventEngine } from '$lib/engine/Events.svelte';
import { DirectorEngine } from '$lib/engine/Director.svelte';
import { AtmosphereEngine } from '$lib/engine/Atmosphere.svelte';

export type { FlightMode } from '$lib/engine/FlightSim.svelte';

// ============================================================================
// TYPES (local to this module)
// ============================================================================

export interface PatchableState {
	altitude: number;
	timeOfDay: number;
	heading: number;
	pitch: number;
	weather: WeatherType;
	cloudDensity: number;
	terrainDarkness: number;
	cloudSpeed: number;
	haze: number;
	nightLightIntensity: number;
	flightSpeed: number;
	syncToRealTime: boolean;
	showClouds: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

function getSkyState(timeOfDay: number): SkyState {
	if (timeOfDay < 5 || timeOfDay >= 20) return 'night';
	if (timeOfDay < 7) return 'dawn';
	if (timeOfDay >= 18) return 'dusk';
	return 'day';
}

// ============================================================================
// MODEL
// ============================================================================

export class WindowModel {
	// --- Flight Engine (position, orbit, cruise state machine) ---
	private readonly flight = new FlightSimEngine({
		setBlindOpen: (open) => { this.blindOpen = open; },
		resetDirector: () => { this.director.reset(); },
		onLocationChanged: (id) => { this.setLocation(id); },
		resetBankAngle: () => { /* bankAngle owned by MotionEngine, resets naturally */ },
	});

	// --- Position (proxy to flight engine) ---
	get lat() { return this.flight.lat; }
	set lat(v: number) { this.flight.lat = v; }
	get lon() { return this.flight.lon; }
	set lon(v: number) { this.flight.lon = v; }
	get altitude() { return this.flight.altitude; }
	set altitude(v: number) { this.flight.altitude = v; }
	get heading() { return this.flight.heading; }
	set heading(v: number) { this.flight.heading = v; }
	get pitch() { return this.flight.pitch; }
	set pitch(v: number) { this.flight.pitch = v; }

	// --- Flight mode (proxy to flight engine) ---
	get flightMode() { return this.flight.flightMode; }
	get cruiseTargetId() { return this.flight.cruiseTargetId; }
	get warpFactor() { return this.flight.warpFactor; }
	get flightSpeed() { return this.flight.flightSpeed; }
	set flightSpeed(v: number) { this.flight.flightSpeed = v; }
	get isTransitioning() { return this.flight.isTransitioning; }
	get cruiseDestinationName() { return this.flight.cruiseDestinationName; }

	// --- Orbit (proxy to flight engine) ---
	get orbitCenterLat() { return this.flight.orbitCenterLat; }
	get orbitCenterLon() { return this.flight.orbitCenterLon; }
	get orbitAngle() { return this.flight.orbitAngle; }

	utcOffset = $state(4);

	// --- Time ---
	timeOfDay = $state(12);
	syncToRealTime = $state(true);

	// --- User override (pause auto-behavior during manual control) ---
	userAdjustingAltitude = $state(false);
	userAdjustingTime = $state(false);
	userAdjustingAtmosphere = $state(false);
	private userOverrideTimeout: ReturnType<typeof setTimeout> | null = null;

	// --- Location ---
	location = $state<LocationId>('dubai');

	// --- Environment ---
	weather = $state<WeatherType>('cloudy');
	cloudDensity = $state(0.7);
	cloudSpeed = $state(0.4);
	haze = $state(0.025);

	// --- View ---
	blindOpen = $state(true);
	showBuildings = $state(true);
	showClouds = $state(true);

	// --- Display mode (fleet-managed) ---
	displayMode = $state<DisplayMode>('flight');
	videoUrl = $state('');
	isFlightMode = $derived(this.displayMode === 'flight');
	isScreensaverMode = $derived(this.displayMode === 'screensaver');
	isVideoMode = $derived(this.displayMode === 'video');

	// --- Cesium quality ---
	qualityMode = $state<QualityMode>('balanced');

	// --- FPS tracking (for fleet health reporting) ---
	private _frameCount = 0;
	private _fpsLastTime = performance.now();
	measuredFps = $state(0);

	// --- Night rendering ---
	nightLightIntensity = $state(0.6);
	terrainDarkness = $state(0);

	// ── Atmosphere (delegated to AtmosphereEngine) ─────────────────────────────
	private readonly atmosphere = new AtmosphereEngine();
	get lightningIntensity() { return this.atmosphere.lightningIntensity; }
	get lightningX() { return this.atmosphere.lightningX; }
	get lightningY() { return this.atmosphere.lightningY; }

	// ── Motion (delegated to MotionEngine) ──────────────────────────────────────
	private readonly motion = new MotionEngine();
	get motionOffsetX() { return this.motion.motionOffsetX; }
	get motionOffsetY() { return this.motion.motionOffsetY; }
	get bankAngle() { return this.motion.bankAngle; }
	get breathingOffset() { return this.motion.breathingOffset; }
	get engineVibeX() { return this.motion.engineVibeX; }
	get engineVibeY() { return this.motion.engineVibeY; }

	// ── Micro-events (delegated to EventEngine) ────────────────────────────────
	private readonly events = new EventEngine();
	get microEvent() { return this.events.microEvent; }

	// ── Director (delegated to DirectorEngine) ─────────────────────────────────
	private readonly director = new DirectorEngine();

	// (Ambient randomization delegated to AtmosphereEngine)

	// --- Animation clock (single source of time) ---
	time = 0;

	// ========================================================================
	// DERIVED
	// ========================================================================

	// Display time = viewer's local time (no timezone conversion).
	// This is a circadian wellbeing display — the sky matches YOUR day/night cycle.
	// The destination provides scenery; the time is always the viewer's.
	get localTimeOfDay(): number { return this.timeOfDay; }

	skyState = $derived<SkyState>(getSkyState(this.timeOfDay));

	/**
	 * Continuous sky interpolation factors (0->1).
	 * Eliminates hard pops at dawn/dusk/night boundaries.
	 *
	 * nightFactor: 0 = full daylight, 1 = full night
	 * dawnDuskFactor: 0 = not in transition, 1 = peak transition
	 */
	nightFactor = $derived.by(() => {
		const t = this.timeOfDay;
		// Dawn: 5->7 (night->day), Dusk: 18->20 (day->night)
		if (t >= 7 && t <= 18) return 0;          // full day
		if (t < 5 || t > 20) return 1;            // full night
		if (t < 7) return 1 - (t - 5) / 2;       // dawn: 1->0
		return (t - 18) / 2;                       // dusk: 0->1
	});

	dawnDuskFactor = $derived.by(() => {
		const t = this.timeOfDay;
		// Peak at midpoints of transition bands (6.0 and 19.0)
		if (t >= 5 && t < 7) return 1 - Math.abs(t - 6);    // dawn: 0->1->0
		if (t >= 18 && t <= 20) return 1 - Math.abs(t - 19); // dusk: 0->1->0
		return 0;
	});

	turbulenceLevel = $derived<'light' | 'moderate' | 'severe'>(
		WEATHER_EFFECTS[this.weather].turbulence
	);

	showLightning = $derived(WEATHER_EFFECTS[this.weather].hasLightning);

	effectiveCloudDensity = $derived.by(() => {
		const fx = WEATHER_EFFECTS[this.weather];
		const [min, max] = fx.cloudDensityRange;
		let density = max > 0 ? clamp(this.cloudDensity, min, max) : this.cloudDensity * 0.3;
		// At night, reduce cloud opacity so Cesium city lights show through.
		// Clouds are CSS layers above the Cesium canvas — they block NASA lights.
		if (this.skyState === 'night') {
			density = Math.max(density * 0.5, fx.nightCloudFloor);
		} else if (this.skyState === 'dusk') {
			density *= 0.7;
		}
		return density;
	});

	currentLocation = $derived(LOCATION_MAP.get(this.location) ?? LOCATIONS[0]);

	/** Normalized night light scale: multiplies VIIRS/CartoDB brightness. Default 0.6 → scale 0.24. */
	nightLightScale = $derived(this.nightLightIntensity / 2.5);

	nightAltitudeTarget = $derived.by(() => {
		const loc = this.currentLocation;
		if (this.skyState === 'night') return loc.nightAltitude;
		if (this.skyState === 'dusk' || this.skyState === 'dawn') {
			return Math.round((loc.defaultAltitude + loc.nightAltitude) / 2);
		}
		return loc.defaultAltitude;
	});


	// ========================================================================
	// CONSTRUCTOR
	// ========================================================================

	constructor() {
		const saved = loadPersistedState();
		if (saved.location) {
			const loc = LOCATION_MAP.get(saved.location);
			if (loc) {
				this.location = saved.location;
				this.utcOffset = loc.utcOffset;
				// Initialize flight engine with saved location
				this.flight.setLocationWithSky(saved.location, 'day');
			}
		} else {
			// Default location (Dubai) — flight engine defaults match
			this.flight.setLocationWithSky('dubai', 'day');
		}

		if (saved.altitude !== undefined) this.altitude = saved.altitude;
		if (saved.weather) this.weather = saved.weather;
		if (saved.cloudDensity !== undefined) this.cloudDensity = saved.cloudDensity;
		if (saved.showBuildings !== undefined) this.showBuildings = saved.showBuildings;
		if (saved.showClouds !== undefined) this.showClouds = saved.showClouds;
		if (saved.syncToRealTime !== undefined) this.syncToRealTime = saved.syncToRealTime;

		if (typeof window !== 'undefined') {
			const now = new Date();
			this.timeOfDay = now.getHours() + now.getMinutes() / 60;
		}

	}

	/** Update timeOfDay from the system clock (called by external $effect) */
	updateTimeFromSystem(): void {
		if (typeof window === 'undefined') return;
		const now = new Date();
		this.timeOfDay = now.getHours() + now.getMinutes() / 60;
	}

	/** Return a snapshot of persisted fields (called by external $effect for auto-save) */
	getPersistedSnapshot(): PersistedState {
		return {
			location: this.location,
			altitude: safeNum(this.altitude, 35000, AIRCRAFT.MIN_ALTITUDE, AIRCRAFT.MAX_ALTITUDE),
			weather: this.weather,
			cloudDensity: safeNum(this.cloudDensity, 0.7, 0, 1),
			showBuildings: this.showBuildings,
			showClouds: this.showClouds,
			syncToRealTime: this.syncToRealTime,
		};
	}

	// ========================================================================
	// ACTIONS
	// ========================================================================

	setLocation(locationId: LocationId): void {
		const loc = LOCATION_MAP.get(locationId);
		if (!loc) return;
		this.location = locationId;
		this.utcOffset = loc.utcOffset;
		this.flight.setLocationWithSky(locationId, this.skyState);
	}

	setAltitude(alt: number): void { this.flight.setAltitude(alt); }

	setTime(time: number): void {
		if (!Number.isFinite(time)) return;
		this.timeOfDay = clamp(time, AIRCRAFT.MIN_TIME, AIRCRAFT.MAX_TIME);
	}

	setWeather(weather: WeatherType): void {
		this.weather = weather;
	}

	setHeading(heading: number): void { this.flight.setHeading(heading); }

	setPitch(pitch: number): void { this.flight.setPitch(pitch); }

	setCloudDensity(density: number): void {
		if (!Number.isFinite(density)) return;
		this.cloudDensity = clamp(density, 0, 1);
	}

	setTerrainDarkness(darkness: number): void {
		if (!Number.isFinite(darkness)) return;
		this.terrainDarkness = clamp(darkness, 0, 1);
	}

	setLat(lat: number): void {
		if (!Number.isFinite(lat)) return;
		this.lat = clamp(lat, -90, 90);
	}

	setLon(lon: number): void {
		if (!Number.isFinite(lon)) return;
		this.lon = clamp(lon, -180, 180);
	}

	/** Pick next location weighted by time of day (nature mornings, cities midday/night) */
	pickNextLocation(): LocationId {
		return this.flight.pickNextLocation(this.localTimeOfDay, this.location);
	}

	toggleBlind(): void { this.blindOpen = !this.blindOpen; }
	toggleBuildings(): void { this.showBuildings = !this.showBuildings; }
	toggleClouds(): void { this.showClouds = !this.showClouds; }

	/** Called by RAF loop on each frame to compute measured FPS */
	reportFrame(): void {
		this._frameCount++;
		const now = performance.now();
		const elapsed = now - this._fpsLastTime;
		if (elapsed >= 1000) {
			this.measuredFps = Math.round((this._frameCount * 1000) / elapsed);
			this._frameCount = 0;
			this._fpsLastTime = now;
		}
	}

	/** Switch display mode (flight / screensaver / video) */
	setDisplayMode(mode: DisplayMode, payload?: string): void {
		const prev = this.displayMode;
		this.displayMode = mode;

		if (mode === 'video' && payload) {
			this.videoUrl = payload;
		}

		// Screensaver: slow dreamy orbit, sync to real time, ensure blind is open
		if (mode === 'screensaver') {
			this.flightSpeed = 0.3;
			this.syncToRealTime = true;
			this.blindOpen = true;
		}

		// Flight: restore normal speed from screensaver, ensure blind open
		if (mode === 'flight' && prev === 'screensaver') {
			this.flightSpeed = 1.0;
			this.blindOpen = true;
		}
	}

	onUserInteraction(type: 'altitude' | 'time' | 'atmosphere'): void {
		if (type === 'altitude') this.userAdjustingAltitude = true;
		else if (type === 'time') this.userAdjustingTime = true;
		else if (type === 'atmosphere') this.userAdjustingAtmosphere = true;

		if (this.userOverrideTimeout) clearTimeout(this.userOverrideTimeout);
		this.userOverrideTimeout = setTimeout(() => {
			this.userAdjustingAltitude = false;
			this.userAdjustingTime = false;
			this.userAdjustingAtmosphere = false;
			this.userOverrideTimeout = null;
		}, 8000);
	}

	/** Validated batch update from UI controls or fleet commands */
	applyPatch(patch: Partial<PatchableState> | DisplayConfig): void {
		if (patch.altitude !== undefined) {
			this.setAltitude(patch.altitude);
			this.onUserInteraction('altitude');
		}
		if (patch.timeOfDay !== undefined) {
			this.setTime(patch.timeOfDay);
			this.onUserInteraction('time');
		}
		if (patch.heading !== undefined) this.setHeading(patch.heading);
		if ('pitch' in patch && patch.pitch !== undefined) this.setPitch(patch.pitch);
		if (patch.weather !== undefined) this.setWeather(patch.weather);
		if (patch.cloudDensity !== undefined) {
			this.setCloudDensity(patch.cloudDensity);
			this.onUserInteraction('atmosphere');
		}
		if ('terrainDarkness' in patch && patch.terrainDarkness !== undefined) this.setTerrainDarkness(patch.terrainDarkness);
		if ('cloudSpeed' in patch && patch.cloudSpeed !== undefined) this.cloudSpeed = clamp(patch.cloudSpeed, 0.1, 3);
		if ('haze' in patch && patch.haze !== undefined) this.haze = clamp(patch.haze, 0, 0.15);
		if (patch.nightLightIntensity !== undefined) this.nightLightIntensity = clamp(patch.nightLightIntensity, 0, 5);
		if (patch.flightSpeed !== undefined) this.flightSpeed = clamp(patch.flightSpeed, 0.1, 5);
		if (patch.syncToRealTime !== undefined) this.syncToRealTime = patch.syncToRealTime;
		if (patch.showClouds !== undefined) this.showClouds = patch.showClouds;
	}

	destroy(): void {
		if (this.userOverrideTimeout) {
			clearTimeout(this.userOverrideTimeout);
			this.userOverrideTimeout = null;
		}
	}

	// ========================================================================
	// FLIGHT TRANSITION
	// ========================================================================

	flyTo(locationId: LocationId): void {
		// If already there/cruising there, ignore
		if (this.location === locationId && this.flightMode === 'orbit') return;
		this.flight.flyTo(locationId);
	}

	// ========================================================================
	// TICK (single game loop — driven by Window.svelte RAF)
	// ========================================================================

	tick(delta: number): void {
		if (!Number.isFinite(delta) || delta < 0 || delta > 0.1) return;
		this.time = (this.time + delta) % 3600;

		// Flight engine: position, orbit, cruise state machine, altitude
		this.flight.tick(delta, {
			time: this.time,
			userAdjustingAltitude: this.userAdjustingAltitude,
			nightAltitudeTarget: this.nightAltitudeTarget,
			skyState: this.skyState,
		});

		// Director only runs during orbit (not during cruise transitions)
		if (this.flightMode === 'orbit') {
			this.tickDirector(delta);
		}

		this.tickLightning(delta);
		this.tickMotion(delta);
		this.tickMicroEvents(delta);
		this.tickRandomize(delta);
	}

	private tickDirector(delta: number): void {
		const nextId = this.director.tick(delta, {
			userAdjusting: this.userAdjustingAltitude || this.userAdjustingTime,
			pickNextLocation: () => this.pickNextLocation(),
		});
		if (nextId) this.flyTo(nextId);
	}

	private tickLightning(delta: number): void {
		this.atmosphere.tickLightning(delta, this.showLightning);
	}

	private tickMotion(delta: number): void {
		this.motion.tick(delta, {
			time: this.time,
			heading: this.heading,
			altitude: this.altitude,
			weather: this.weather,
			turbulenceLevel: this.turbulenceLevel,
		});
	}

	private tickMicroEvents(delta: number): void {
		this.events.tick(delta, { skyState: this.skyState });
	}

	private tickRandomize(delta: number): void {
		const patch = this.atmosphere.tickRandomize(delta, {
			userAdjusting: this.userAdjustingAtmosphere,
			cloudDensity: this.cloudDensity,
			cloudSpeed: this.cloudSpeed,
			haze: this.haze,
		});
		if (patch) {
			if (patch.cloudDensity !== undefined) this.cloudDensity = patch.cloudDensity;
			if (patch.cloudSpeed !== undefined) this.cloudSpeed = patch.cloudSpeed;
			if (patch.haze !== undefined) this.haze = patch.haze;
			if (patch.weather !== undefined) this.weather = patch.weather;
		}
	}
}
