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

import { clamp, lerp, normalizeHeading } from '$lib/shared/utils';
import { AIRCRAFT, WEATHER_EFFECTS } from '$lib/shared/constants';
import type { SkyState, LocationId, WeatherType } from '$lib/shared/types';
import type { DisplayMode, DisplayConfig } from '$lib/shared/protocol';
import type { QualityMode } from '$lib/shared/constants';
import { LOCATIONS, LOCATION_MAP } from '$lib/shared/locations';
import { loadPersistedState, safeNum, type PersistedState } from './persistence';
import { pickScenario, type FlightScenario } from './flight-scenarios';
import { MotionEngine } from '$lib/engine/Motion.svelte';
import { EventEngine } from '$lib/engine/Events.svelte';
import { DirectorEngine } from '$lib/engine/Director.svelte';
import { AtmosphereEngine } from '$lib/engine/Atmosphere.svelte';

export type FlightMode = 'orbit' | 'cruise_departure' | 'cruise_transit';

// ============================================================================
// TYPES
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
	// ── Position ────────────────────────────────────────────────────────────────
	lat = $state(25.2048);
	lon = $state(55.2708);
	altitude = $state(35000);
	heading = $state(45);
	pitch = $state(75);

	// ── Time ────────────────────────────────────────────────────────────────────
	timeOfDay = $state(12);
	syncToRealTime = $state(true);

	// ── User override (pause auto-behavior during manual control) ──────────────
	userAdjustingAltitude = $state(false);
	userAdjustingTime = $state(false);
	userAdjustingAtmosphere = $state(false);
	private userOverrideTimeout: ReturnType<typeof setTimeout> | null = null;

	// ── Location ───────────────────────────────────────────────────────────────
	location = $state<LocationId>('dubai');
	utcOffset = $state(4);

	// ── Environment ─────────────────────────────────────────────────────────────
	weather = $state<WeatherType>('cloudy');
	cloudDensity = $state(0.7);
	cloudSpeed = $state(0.4);
	haze = $state(0.025);

	// ── View ───────────────────────────────────────────────────────────────────
	blindOpen = $state(true);
	showBuildings = $state(true);
	showClouds = $state(true);

	// ── Display mode (fleet-managed) ────────────────────────────────────────────
	displayMode = $state<DisplayMode>('flight');
	videoUrl = $state('');
	isFlightMode = $derived(this.displayMode === 'flight');
	isScreensaverMode = $derived(this.displayMode === 'screensaver');
	isVideoMode = $derived(this.displayMode === 'video');

	// ── Cesium quality ─────────────────────────────────────────────────────────
	qualityMode = $state<QualityMode>('balanced');

	// ── FPS tracking ───────────────────────────────────────────────────────────
	private _frameCount = 0;
	private _fpsLastTime = performance.now();
	measuredFps = $state(0);

	// ── Night rendering ─────────────────────────────────────────────────────────
	// terrainDarkness=0: terrain stays bright at night, color grading shader
	// warm-tints the grayscale terrain to create city glow from the hi-res texture.
	// nightLightIntensity=0.6: VIIRS/CartoDB overlays kept very subtle (scale=0.24).
	nightLightIntensity = $state(0.6);
	terrainDarkness = $state(0);

	// ── Flight speed ────────────────────────────────────────────────────────────
	flightSpeed = $state(1.0);

	// ── Orbit flight path (fallback ellipse when no scenario exists) ────────────
	orbitCenterLat = $state(25.2048);
	orbitCenterLon = $state(55.2708);
	orbitRadiusMajor: number = $state(AIRCRAFT.ORBIT_MAJOR);
	orbitRadiusMinor: number = $state(AIRCRAFT.ORBIT_MINOR);
	orbitBearing = $state(0); // radians — orientation of the flight path
	orbitAngle = $state(0);   // radians, increments over time

	// ── Waypoint-based flight scenario (replaces orbit when available) ───────────
	private currentScenario: FlightScenario | null = null;
	private scenarioWaypointIndex = 0;
	private scenarioProgress = 0; // 0-1 between current and next waypoint

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

	// ── Flight Modes (Cinematic) ────────────────────────────────────────────────
	flightMode = $state<FlightMode>('orbit');
	cruiseTargetId = $state<LocationId | null>(null);
	cruiseElapsed = 0;   // Timer for transition phases
	warpFactor = $state(0); // 0=normal, 1=full warp speed
	private preWarpSpeed = 1.0; // saved flightSpeed before warp acceleration

	// ── Derived from flight mode ────────────────────────────────────────────────
	isTransitioning = $derived(this.flightMode !== 'orbit');
	cruiseDestinationName = $derived(
		this.cruiseTargetId ? (LOCATION_MAP.get(this.cruiseTargetId)?.name ?? this.cruiseTargetId) : null
	);

	// ── Director (delegated to DirectorEngine) ─────────────────────────────────
	private readonly director = new DirectorEngine();

	// (Ambient randomization delegated to AtmosphereEngine)

	// ── Animation clock (single source of time) ─────────────────────────────────
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
		if (t >= 7 && t <= 18) return 0;
		if (t < 5 || t > 20) return 1;
		if (t < 7) return 1 - (t - 5) / 2;
		return (t - 18) / 2;
	});

	dawnDuskFactor = $derived.by(() => {
		const t = this.timeOfDay;
		if (t >= 5 && t < 7) return 1 - Math.abs(t - 6);
		if (t >= 18 && t <= 20) return 1 - Math.abs(t - 19);
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
				this.lat = loc.lat;
				this.lon = loc.lon;
				this.utcOffset = loc.utcOffset;
				this.orbitCenterLat = loc.lat;
				this.orbitCenterLon = loc.lon;
				this.orbitBearing = this.computeOrbitBearing(loc.lat, loc.lon);
			}
		} else {
			this.orbitBearing = this.computeOrbitBearing(this.lat, this.lon);
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

		this.initScenario(this.location);
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
		this.lat = loc.lat;
		this.lon = loc.lon;
		this.utcOffset = loc.utcOffset;
		this.orbitCenterLat = loc.lat;
		this.orbitCenterLon = loc.lon;
		this.orbitBearing = this.computeOrbitBearing(loc.lat, loc.lon);
		this.orbitAngle = 0;

		this.initScenario(locationId);
	}

	// Deterministic hash to spread orbit orientations across locations
	private computeOrbitBearing(lat: number, lon: number): number {
		return (Math.abs(lat * 37 + lon * 59) % 180) * Math.PI / 180;
	}

	setAltitude(alt: number): void {
		if (!Number.isFinite(alt)) return;
		this.altitude = clamp(alt, AIRCRAFT.MIN_ALTITUDE, AIRCRAFT.MAX_ALTITUDE);
	}

	setTime(time: number): void {
		if (!Number.isFinite(time)) return;
		this.timeOfDay = clamp(time, AIRCRAFT.MIN_TIME, AIRCRAFT.MAX_TIME);
	}

	setWeather(weather: WeatherType): void {
		this.weather = weather;
	}

	setHeading(heading: number): void {
		if (!Number.isFinite(heading)) return;
		this.heading = normalizeHeading(heading);
	}

	setPitch(pitch: number): void {
		if (!Number.isFinite(pitch)) return;
		this.pitch = clamp(pitch, -90, 90);
	}

	setCloudDensity(density: number): void {
		if (!Number.isFinite(density)) return;
		this.cloudDensity = clamp(density, 0, 1);
	}

	setTerrainDarkness(darkness: number): void {
		if (!Number.isFinite(darkness)) return;
		this.terrainDarkness = clamp(darkness, 0, 1);
	}

	/** Pick next location weighted by time of day (nature mornings, cities midday/night) */
	pickNextLocation(): LocationId {
		const hour = this.localTimeOfDay;
		const preferCity = (hour >= 10 && hour < 16) || hour >= 19 || hour < 5;
		const candidates = LOCATIONS.filter(l => l.id !== this.location);
		const preferred = candidates.filter(l => preferCity ? l.hasBuildings : !l.hasBuildings);
		const pool = preferred.length > 0 ? preferred : candidates;
		return pool[Math.floor(Math.random() * pool.length)].id;
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

		if (mode === 'screensaver') {
			this.flightSpeed = 0.3;
			this.syncToRealTime = true;
			this.blindOpen = true;
		}

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
		if (this.location === locationId && this.flightMode === 'orbit') return;
		if (this.cruiseTargetId === locationId) return;
		const target = LOCATION_MAP.get(locationId);
		if (!target) return;

		this.cruiseTargetId = locationId;
		this.flightMode = 'cruise_departure';
		this.cruiseElapsed = 0;
		this.warpFactor = 0;
		this.preWarpSpeed = this.flightSpeed;
	}

	// ========================================================================
	// TICK (single game loop — driven by Window.svelte RAF)
	// ========================================================================

	tick(delta: number): void {
		if (!Number.isFinite(delta) || delta < 0 || delta > 0.1) return;
		this.time = (this.time + delta) % 3600;

		if (this.flightMode === 'cruise_departure') {
			this.tickDeparture(delta);
			this.tickFlightPath(delta);
		} else if (this.flightMode === 'cruise_transit') {
			this.tickTransit(delta);
		} else {
			this.tickFlightPath(delta);
			this.tickDirector(delta);
		}

		this.tickLightning(delta);
		this.tickMotion(delta);
		this.tickAltitude(delta);
		this.tickMicroEvents(delta);
		this.tickRandomize(delta);
	}

	// --- Cruise Logic ---

	private tickDeparture(delta: number): void {
		this.cruiseElapsed += delta;

		const warpDuration = 2.5;
		const t = clamp(this.cruiseElapsed / warpDuration, 0, 1);
		this.warpFactor = t * t * (3 - 2 * t);

		const warpSpeed = this.preWarpSpeed + this.warpFactor * 100;
		this.flightSpeed = warpSpeed;

		if (this.cruiseElapsed > 2.0) {
			this.blindOpen = false;
			this.flightMode = 'cruise_transit';
			this.cruiseElapsed = 0;
		}
	}

	private tickTransit(delta: number): void {
		this.cruiseElapsed += delta;

		const decay = clamp(this.warpFactor - delta * 2.5, 0, 1);
		this.warpFactor = decay * decay;

		this.flightSpeed = this.preWarpSpeed + this.warpFactor * 100;

		if (this.cruiseElapsed > 2.0 && this.cruiseTargetId) {
			this.setLocation(this.cruiseTargetId);
			this.cruiseTargetId = null;
			this.flightMode = 'orbit';
			this.blindOpen = true;
			this.warpFactor = 0;
			this.flightSpeed = this.preWarpSpeed;
			this.director.reset();
		}
	}

	private tickDirector(delta: number): void {
		const nextId = this.director.tick(delta, {
			userAdjusting: this.userAdjustingAltitude || this.userAdjustingTime,
			pickNextLocation: () => this.pickNextLocation(),
		});
		if (nextId) this.flyTo(nextId);
	}

	// --- Flight Path ---

	private tickOrbit(delta: number): void {
		const breathePhase = (this.time / AIRCRAFT.ORBIT_BREATHE_PERIOD) * Math.PI * 2;
		const breathe = (Math.sin(breathePhase) + 1) * 0.5;
		const majorRange = AIRCRAFT.ORBIT_MAJOR_MAX - AIRCRAFT.ORBIT_MAJOR_MIN;
		this.orbitRadiusMajor = AIRCRAFT.ORBIT_MAJOR_MIN + breathe * majorRange;
		this.orbitRadiusMinor = this.orbitRadiusMajor * (0.35 + breathe * 0.15);

		const a = this.orbitRadiusMajor;
		const b = this.orbitRadiusMinor;

		const tx = a * Math.cos(this.orbitAngle);
		const ty = -b * Math.sin(this.orbitAngle);
		const localSpeed = Math.sqrt(tx * tx + ty * ty);
		const angularSpeed = (AIRCRAFT.DRIFT_RATE * this.flightSpeed) / Math.max(localSpeed, 0.001);
		this.orbitAngle += angularSpeed * delta;
		if (this.orbitAngle > Math.PI * 2) this.orbitAngle -= Math.PI * 2;

		const ex = a * Math.sin(this.orbitAngle);
		const ey = b * Math.cos(this.orbitAngle);
		const cb = Math.cos(this.orbitBearing);
		const sb = Math.sin(this.orbitBearing);
		const cosLat = Math.cos(this.orbitCenterLat * Math.PI / 180);

		const newLat = this.orbitCenterLat + (ex * cb - ey * sb);
		const newLon = this.orbitCenterLon + (ex * sb + ey * cb) / Math.max(cosLat, 0.1);
		if (Number.isFinite(newLat)) this.lat = newLat;
		if (Number.isFinite(newLon)) this.lon = newLon;

		const rtx = tx * cb - ty * sb;
		const rty = tx * sb + ty * cb;
		const tangentHeading = (Math.atan2(rty, rtx) * 180) / Math.PI;
		const baseHeading = normalizeHeading(tangentHeading);

		const wander = Math.sin(this.time * 0.05) * 0.25
			+ Math.sin(this.time * 0.031) * 0.15
			+ Math.sin(this.time * 0.017) * 0.1;
		this.heading = normalizeHeading(baseHeading + wander);
	}

	private tickFlightPath(delta: number): void {
		if (this.currentScenario) {
			this.tickScenario(delta);
		} else {
			this.tickOrbit(delta);
		}
	}

	private initScenario(locationId: LocationId): void {
		const scenario = pickScenario(locationId, this.skyState);
		this.currentScenario = scenario;
		this.scenarioWaypointIndex = 0;
		this.scenarioProgress = 0;
	}

	private tickScenario(delta: number): void {
		const scenario = this.currentScenario;
		if (!scenario || scenario.waypoints.length < 2) return;

		const waypoints = scenario.waypoints;
		const idx = this.scenarioWaypointIndex;
		const nextIdx = (idx + 1) % waypoints.length;
		const current = waypoints[idx];
		const next = waypoints[nextIdx];

		const duration = next.duration > 0 ? next.duration : 30;
		this.scenarioProgress += (delta * this.flightSpeed) / duration;

		const raw = clamp(this.scenarioProgress, 0, 1);
		const t = raw * raw * (3 - 2 * raw);

		const jitterScale = 0.0003;
		const jitterLat = Math.sin(this.time * 0.13) * jitterScale + Math.sin(this.time * 0.31) * jitterScale * 0.5;
		const jitterLon = Math.sin(this.time * 0.17) * jitterScale + Math.sin(this.time * 0.37) * jitterScale * 0.5;

		const newLat = lerp(current.lat, next.lat, t) + jitterLat;
		const newLon = lerp(current.lon, next.lon, t) + jitterLon;
		if (Number.isFinite(newLat)) this.lat = newLat;
		if (Number.isFinite(newLon)) this.lon = newLon;

		if (!this.userAdjustingAltitude) {
			const altJitter = Math.sin(this.time * 0.07) * 50;
			this.altitude = lerp(current.altitude, next.altitude, t) + altJitter;
		}

		let headingDiff = next.heading - current.heading;
		if (headingDiff > 180) headingDiff -= 360;
		if (headingDiff < -180) headingDiff += 360;
		const headingJitter = Math.sin(this.time * 0.05) * 0.25 + Math.sin(this.time * 0.031) * 0.15;
		this.heading = normalizeHeading(current.heading + headingDiff * t + headingJitter);

		if (this.scenarioProgress >= 1) {
			this.scenarioProgress = 0;
			this.scenarioWaypointIndex = nextIdx;

			if (nextIdx === 0 && scenario.loop) {
				const fresh = pickScenario(this.location, this.skyState);
				if (fresh && fresh.id !== scenario.id) {
					this.currentScenario = fresh;
					this.scenarioWaypointIndex = 0;
					this.scenarioProgress = 0;
				}
			}
		}
	}

	// --- Weather ---

	private tickLightning(delta: number): void {
		this.atmosphere.tickLightning(delta, this.showLightning);
	}

	// --- Motion ---

	private tickMotion(delta: number): void {
		this.motion.tick(delta, {
			time: this.time,
			heading: this.heading,
			altitude: this.altitude,
			weather: this.weather,
			turbulenceLevel: this.turbulenceLevel,
		});
	}

	private tickAltitude(delta: number): void {
		if (this.userAdjustingAltitude) return;
		const target = this.nightAltitudeTarget;
		const diff = target - this.altitude;
		if (Math.abs(diff) > 500) {
			this.altitude += Math.sign(diff) * Math.min(Math.abs(diff) * 0.01, 50) * delta * 60;
		}
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
