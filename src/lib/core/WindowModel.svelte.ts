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

import { clamp, normalizeHeading } from './utils';
import { AIRCRAFT, FLIGHT_FEEL, AMBIENT, MICRO_EVENTS } from './constants';
import type { SkyState, LocationId, WeatherType } from './types';
import { LOCATIONS, LOCATION_MAP } from './locations';
import { loadPersistedState, safeNum, type PersistedState } from './persistence';
import { WEATHER_EFFECTS } from './constants';

export type FlightMode = 'orbit' | 'cruise_departure' | 'cruise_transit';

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
	// --- Position ---
	lat = $state(25.2048);
	lon = $state(55.2708);
	utcOffset = $state(4);
	altitude = $state(35000);
	heading = $state(45);
	pitch = $state(75);

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

	// --- Night rendering ---
	nightLightIntensity = $state(2.5);
	terrainDarkness = $state(0.60);

	// --- Flight speed ---
	flightSpeed = $state(1.0);

	// --- Orbit flight path (elongated ellipse for linear flight feel) ---
	orbitCenterLat = $state(25.2048);
	orbitCenterLon = $state(55.2708);
	orbitRadiusMajor = $state(AIRCRAFT.ORBIT_MAJOR); // long axis (~33km straight legs)
	orbitRadiusMinor = $state(AIRCRAFT.ORBIT_MINOR); // short axis (~9km turn radius)
	orbitBearing = $state(0); // radians — orientation of the flight path
	orbitAngle = $state(0); // radians, increments over time

	// --- Weather animation ---
	lightningIntensity = $state(0);
	lightningX = $state(50);    // % position for positional lightning
	lightningY = $state(40);    // % position for positional lightning
	private lightningTimer = 0;
	private nextLightning = Math.random() * (AIRCRAFT.LIGHTNING_MAX_INTERVAL - AIRCRAFT.LIGHTNING_MIN_INTERVAL) + AIRCRAFT.LIGHTNING_MIN_INTERVAL;

	// --- Motion (each layer independent and modular) ---
	motionOffsetX = $state(0);     // lateral sway (0.3x Y amplitude)
	motionOffsetY = $state(0);     // turbulence + base vibration
	bankAngle = $state(0);         // degrees — horizon tilt from turn rate
	breathingOffset = $state(0);   // normalized — slow pitch oscillation
	engineVibeX = $state(0);       // pixels — high-freq engine hum X
	engineVibeY = $state(0);       // pixels — high-freq engine hum Y
	private prevHeading = 0;       // for computing turn rate

	// --- Turbulence bumps (occasional jolts simulating air pockets) ---
	private bumpTimer = 0;
	private nextBump = FLIGHT_FEEL.BUMP_MIN_INTERVAL + Math.random() * (FLIGHT_FEEL.BUMP_MAX_INTERVAL - FLIGHT_FEEL.BUMP_MIN_INTERVAL);
	private bumpElapsed = -1;      // <0 means no active bump
	private bumpSign = 1;          // direction of current bump

	// --- Micro-events (moments of surprise for attentive viewers) ---
	microEvent = $state<{ type: 'shooting-star' | 'bird' | 'contrail'; elapsed: number; duration: number; x: number; y: number } | null>(null);
	private microEventTimer = 0;
	private nextMicroEvent: number = MICRO_EVENTS.INITIAL_DELAY;

	// --- Flight Modes (Cinematic) ---
	flightMode = $state<FlightMode>('orbit');
	cruiseTargetId = $state<LocationId | null>(null);
	cruiseElapsed = 0; // Timer for transition phases
	warpFactor = $state(0); // 0=normal, 1=full warp speed
	private preWarpSpeed = 1.0; // saved flightSpeed before warp acceleration

	// --- Derived from flight mode (replaces old isTransitioning $state) ---
	isTransitioning = $derived(this.flightMode !== 'orbit');
	cruiseDestinationName = $derived(
		this.cruiseTargetId ? (LOCATION_MAP.get(this.cruiseTargetId)?.name ?? this.cruiseTargetId) : null
	);

	// --- Director (Auto-Pilot) ---
	// "Loiter" for 2-5 minutes, then "Cruise" to new location
	private directorTimer = 0;
	private timeToNextCruise = 120 + Math.random() * 180; // seconds

	// --- Ambient randomization ---
	private nextRandomizeTime = AMBIENT.INITIAL_MIN_DELAY + Math.random() * (AMBIENT.INITIAL_MAX_DELAY - AMBIENT.INITIAL_MIN_DELAY);
	private randomizeTimer = 0;

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

	/** Normalized night light intensity: 1.0 = default (2.5), range [0, 2.0] */
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
			// Default location (Dubai)
			this.orbitBearing = this.computeOrbitBearing(this.lat, this.lon);
		}

		// Initial Director timer
		this.timeToNextCruise = 120 + Math.random() * 180;

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

		// Initialize prevHeading to avoid bank angle jump on first frame
		this.prevHeading = this.heading;
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

	/** Validated batch update from UI controls */
	applyPatch(patch: Partial<PatchableState>): void {
		if (patch.altitude !== undefined) this.setAltitude(patch.altitude);
		if (patch.timeOfDay !== undefined) this.setTime(patch.timeOfDay);
		if (patch.heading !== undefined) this.setHeading(patch.heading);
		if (patch.pitch !== undefined) this.setPitch(patch.pitch);
		if (patch.weather !== undefined) this.setWeather(patch.weather);
		if (patch.cloudDensity !== undefined) this.setCloudDensity(patch.cloudDensity);
		if (patch.terrainDarkness !== undefined) this.setTerrainDarkness(patch.terrainDarkness);
		if (patch.cloudSpeed !== undefined) this.cloudSpeed = clamp(patch.cloudSpeed, 0.1, 3);
		if (patch.haze !== undefined) this.haze = clamp(patch.haze, 0, 0.15);
		if (patch.nightLightIntensity !== undefined) this.nightLightIntensity = clamp(patch.nightLightIntensity, 0.5, 5);
		if (patch.flightSpeed !== undefined) this.flightSpeed = clamp(patch.flightSpeed, 0.1, 5);
		if (patch.syncToRealTime !== undefined) this.syncToRealTime = patch.syncToRealTime;
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
			this.tickOrbit(delta); // Keep orbiting — terrain rushes past during acceleration
		} else if (this.flightMode === 'cruise_transit') {
			this.tickTransit(delta);
		} else {
			this.tickOrbit(delta);
			this.tickDirector(delta);
		}

		this.tickLightning(delta);
		this.tickMotion(delta);
		this.tickAltitude(delta);
		this.tickMicroEvents(delta);
		this.tickRandomize(delta);
	}

	// --- Cruise Logic ---
	// --- Cruise / Transition Logic ---

	private tickDeparture(delta: number): void {
		this.cruiseElapsed += delta;

		// Warp ramp: 0→1 over ~2.5s with smoothstep
		const warpDuration = 2.5;
		const t = clamp(this.cruiseElapsed / warpDuration, 0, 1);
		this.warpFactor = t * t * (3 - 2 * t); // smoothstep

		// Physically accelerate: ramp orbit speed from normal to 100x
		// The terrain actually rushes past in Cesium — real "acceleration" feel
		const warpSpeed = this.preWarpSpeed + this.warpFactor * 100;
		this.flightSpeed = warpSpeed;

		// After warp peaks (2.0s), close blind and transition
		if (this.cruiseElapsed > 2.0) {
			this.blindOpen = false;
			this.flightMode = 'cruise_transit';
			this.cruiseElapsed = 0;
		}
	}

	private tickTransit(delta: number): void {
		this.cruiseElapsed += delta;

		// Fade warp back to 0 with ease-out (matches smoothstep ramp-up)
		const decay = clamp(this.warpFactor - delta * 2.5, 0, 1);
		this.warpFactor = decay * decay; // quadratic ease-out: fast initial decay, smooth end

		// Decelerate back toward normal speed behind the blind
		this.flightSpeed = this.preWarpSpeed + this.warpFactor * 100;

		// While blind is closed, we teleport.
		// Wait 2 seconds for the "feel" of travel/blind closing animation
		if (this.cruiseElapsed > 2.0 && this.cruiseTargetId) {
			this.setLocation(this.cruiseTargetId);
			this.cruiseTargetId = null;
			this.flightMode = 'orbit';

			// Open the blind to reveal new location
			this.blindOpen = true;

			// Reset flight parameters
			this.warpFactor = 0;
			this.bankAngle = 0;
			this.flightSpeed = this.preWarpSpeed;
			this.timeToNextCruise = 120 + Math.random() * 180;
		}
	}

	private tickDirector(delta: number): void {
		if (this.userAdjustingAltitude || this.userAdjustingTime) {
			this.directorTimer = 0;
			return;
		}

		this.directorTimer += delta;
		if (this.directorTimer > this.timeToNextCruise) {
			const next = this.pickNextLocation();
			this.flyTo(next);
			this.directorTimer = 0;
		}
	}

	private tickOrbit(delta: number): void {
		const a = this.orbitRadiusMajor;
		const b = this.orbitRadiusMinor;

		// Arc-length parameterization: constant ground speed, variable angular speed.
		// On straights (near major axis): slow angular speed -> sustained forward flight.
		// On turns (near minor axis): fast angular speed -> quick heading changes.
		const tx = a * Math.cos(this.orbitAngle);
		const ty = -b * Math.sin(this.orbitAngle);
		const localSpeed = Math.sqrt(tx * tx + ty * ty);
		const angularSpeed = (AIRCRAFT.DRIFT_RATE * this.flightSpeed) / Math.max(localSpeed, 0.001);
		this.orbitAngle += angularSpeed * delta;
		if (this.orbitAngle > Math.PI * 2) this.orbitAngle -= Math.PI * 2;

		// Elliptical position, rotated by orbit bearing
		const ex = a * Math.sin(this.orbitAngle);
		const ey = b * Math.cos(this.orbitAngle);
		const cb = Math.cos(this.orbitBearing);
		const sb = Math.sin(this.orbitBearing);
		const cosLat = Math.cos(this.orbitCenterLat * Math.PI / 180);

		const newLat = this.orbitCenterLat + (ex * cb - ey * sb);
		const newLon = this.orbitCenterLon + (ex * sb + ey * cb) / Math.max(cosLat, 0.1);
		if (Number.isFinite(newLat)) this.lat = newLat;
		if (Number.isFinite(newLon)) this.lon = newLon;

		// Heading from ellipse tangent (reuse tx/ty, rotate by bearing)
		// rtx = northward velocity, rty = eastward velocity
		// Geographic heading = atan2(east, north) — clockwise from north
		const rtx = tx * cb - ty * sb;
		const rty = tx * sb + ty * cb;
		const tangentHeading = (Math.atan2(rty, rtx) * 180) / Math.PI;
		const baseHeading = normalizeHeading(tangentHeading);

		// Subtle heading wander (barely perceptible — avoids forward/back oscillation)
		const wander = Math.sin(this.time * 0.05) * 0.25
			+ Math.sin(this.time * 0.031) * 0.15
			+ Math.sin(this.time * 0.017) * 0.1;
		this.heading = normalizeHeading(baseHeading + wander);
	}

	private tickLightning(delta: number): void {
		if (this.showLightning) {
			this.lightningTimer += delta;
			if (this.lightningIntensity > 0) {
				this.lightningIntensity = clamp(this.lightningIntensity - delta * AIRCRAFT.LIGHTNING_DECAY_RATE, 0, 1);
			}
			if (this.lightningIntensity < 0.01 && this.lightningTimer > this.nextLightning) {
				this.lightningIntensity = 0.5 + Math.random() * 0.5;
				// Randomize flash position (illumination from within clouds)
				this.lightningX = 20 + Math.random() * 60;
				this.lightningY = 15 + Math.random() * 50;
				this.lightningTimer = 0;
				this.nextLightning = Math.random() * (AIRCRAFT.LIGHTNING_MAX_INTERVAL - AIRCRAFT.LIGHTNING_MIN_INTERVAL) + AIRCRAFT.LIGHTNING_MIN_INTERVAL;
			}
		} else {
			this.lightningIntensity = 0;
		}
	}

	private tickMotion(delta: number): void {
		const t = this.time;
		const turbMult = AIRCRAFT.TURBULENCE_MULTIPLIERS[this.turbulenceLevel];

		// Altitude-dependent turbulence: near-zero above 40k in clear, stronger near tropopause
		const altFactor = this.altitude > 40000 && this.weather === 'clear'
			? clamp(1 - (this.altitude - 40000) / 10000, 0.05, 1)
			: 1;

		// Base low-freq sway (Y + X at 0.3x with phase offset)
		const baseTurbY = (Math.sin(t * 0.5) * 0.1 + Math.sin(t * 1.1) * 0.08) * turbMult;
		const baseTurbX = (Math.sin(t * 0.37) * 0.08 + Math.sin(t * 0.83) * 0.06) * turbMult;

		// Mid-frequency chatter (2.5Hz + 3.7Hz — constant "airplane" feel)
		const chatterY = (Math.sin(t * 2.5 * Math.PI * 2) * 0.03
			+ Math.sin(t * 3.7 * Math.PI * 2) * 0.02) * turbMult;
		const chatterX = (Math.sin(t * 2.1 * Math.PI * 2) * 0.01
			+ Math.sin(t * 3.3 * Math.PI * 2) * 0.008) * turbMult;

		// Turbulence bumps — amplitude and interval scale with turbulence level
		const bumpAmpScale = turbMult;
		const bumpIntervalScale = 1 / turbMult; // more frequent in heavy turbulence
		let bumpValue = 0;
		this.bumpTimer += delta;
		if (this.bumpElapsed >= 0) {
			this.bumpElapsed += delta;
			bumpValue = this.bumpSign * FLIGHT_FEEL.BUMP_AMPLITUDE * bumpAmpScale
				* Math.exp(-FLIGHT_FEEL.BUMP_DECAY * this.bumpElapsed)
				* Math.sin(FLIGHT_FEEL.BUMP_RING_FREQ * this.bumpElapsed);
			if (this.bumpElapsed > 1.5) this.bumpElapsed = -1; // bump faded
		} else if (this.bumpTimer > this.nextBump) {
			this.bumpTimer = 0;
			this.bumpElapsed = 0;
			this.bumpSign = Math.random() > 0.5 ? 1 : -1;
			this.nextBump = (FLIGHT_FEEL.BUMP_MIN_INTERVAL
				+ Math.random() * (FLIGHT_FEEL.BUMP_MAX_INTERVAL - FLIGHT_FEEL.BUMP_MIN_INTERVAL))
				* bumpIntervalScale;
		}

		this.motionOffsetY = (baseTurbY * AIRCRAFT.TURBULENCE_OFFSET_Y + chatterY + bumpValue) * altFactor;
		this.motionOffsetX = (baseTurbX * AIRCRAFT.TURBULENCE_OFFSET_Y * 0.3 + chatterX) * altFactor;

		// Banking (roll from turn rate)
		let headingDelta = this.heading - this.prevHeading;
		if (headingDelta > 180) headingDelta -= 360;
		if (headingDelta < -180) headingDelta += 360;
		const turnRate = delta > 0 ? headingDelta / delta : 0;
		const targetBank = clamp(turnRate * 0.3, -FLIGHT_FEEL.BANK_ANGLE_MAX, FLIGHT_FEEL.BANK_ANGLE_MAX);
		this.bankAngle += (targetBank - this.bankAngle) * Math.min(FLIGHT_FEEL.BANK_SMOOTHING * delta, 1);
		this.prevHeading = this.heading;

		// Pitch breathing (slow sinusoidal)
		this.breathingOffset = Math.sin(t * (2 * Math.PI / FLIGHT_FEEL.BREATHING_PERIOD));

		// Engine micro-vibration
		this.engineVibeX = Math.sin(t * FLIGHT_FEEL.ENGINE_VIBE_FREQ_X) * FLIGHT_FEEL.ENGINE_VIBE_AMP;
		this.engineVibeY = Math.sin(t * FLIGHT_FEEL.ENGINE_VIBE_FREQ_Y) * FLIGHT_FEEL.ENGINE_VIBE_AMP;
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
		// Advance active event
		if (this.microEvent) {
			this.microEvent.elapsed += delta;
			if (this.microEvent.elapsed >= this.microEvent.duration) {
				this.microEvent = null;
			}
			return;
		}

		// Count down to next event
		this.microEventTimer += delta;
		if (this.microEventTimer < this.nextMicroEvent) return;

		this.microEventTimer = 0;
		this.nextMicroEvent = MICRO_EVENTS.MIN_INTERVAL
			+ Math.random() * (MICRO_EVENTS.MAX_INTERVAL - MICRO_EVENTS.MIN_INTERVAL);

		// Choose event type based on sky state
		const isNightTime = this.skyState === 'night';
		const roll = Math.random();

		let type: 'shooting-star' | 'bird' | 'contrail';
		let duration: number;

		if (isNightTime) {
			type = 'shooting-star';
			duration = MICRO_EVENTS.SHOOTING_STAR_DURATION;
		} else if (roll < 0.4) {
			type = 'bird';
			duration = MICRO_EVENTS.BIRD_DURATION;
		} else {
			type = 'contrail';
			duration = MICRO_EVENTS.CONTRAIL_DURATION;
		}

		this.microEvent = {
			type,
			elapsed: 0,
			duration,
			x: 10 + Math.random() * 80,
			y: 5 + Math.random() * 40,
		};
	}

	private tickRandomize(delta: number): void {
		this.randomizeTimer += delta;
		if (this.randomizeTimer < this.nextRandomizeTime) return;
		if (this.userAdjustingAtmosphere) return;
		this.randomizeTimer = 0;
		this.nextRandomizeTime = AMBIENT.SUBSEQUENT_MIN_DELAY +
			Math.random() * (AMBIENT.SUBSEQUENT_MAX_DELAY - AMBIENT.SUBSEQUENT_MIN_DELAY);

		const cloudShift = (Math.random() - 0.5) * AMBIENT.CLOUD_DENSITY_SHIFT;
		this.cloudDensity = clamp(this.cloudDensity + cloudShift, AMBIENT.CLOUD_DENSITY_MIN, AMBIENT.CLOUD_DENSITY_MAX);

		const speedShift = (Math.random() - 0.5) * AMBIENT.CLOUD_SPEED_SHIFT;
		this.cloudSpeed = clamp(this.cloudSpeed + speedShift, AMBIENT.CLOUD_SPEED_MIN, AMBIENT.CLOUD_SPEED_MAX);

		const hazeShift = (Math.random() - 0.5) * AMBIENT.HAZE_SHIFT;
		this.haze = clamp(this.haze + hazeShift, AMBIENT.HAZE_MIN, AMBIENT.HAZE_MAX);

		if (Math.random() < AMBIENT.WEATHER_CHANGE_CHANCE) {
			const weatherOptions: WeatherType[] = ['clear', 'cloudy', 'cloudy', 'rain', 'overcast'];
			this.weather = weatherOptions[Math.floor(Math.random() * weatherOptions.length)];
		}
	}
}
