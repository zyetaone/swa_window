/**
 * WindowModel - Single Source of Truth
 *
 * All authoritative state lives here. Components derive from this.
 * No callbacks, no bidirectional sync, no duplicate state.
 *
 * Architecture:
 * - Model: Pure data ($state)
 * - Derived: Computed values ($derived)
 * - Actions: Methods that update model
 * - tick(): Single animation update for all time-based state
 */

import type { SkyState, SunPosition } from './types';
import { getSkyState, calculateSunPosition } from './utils/time-utils';
import { getBiomeColors, type BiomeColors } from './EnvironmentSystem';
import { easeInOutCubic } from './utils/math-utils';
import { AIRCRAFT } from './constants';

// ============================================================================
// TYPES
// ============================================================================

export type LocationId = 'dubai' | 'himalayas' | 'mumbai' | 'ocean' | 'desert' | 'clouds' | 'hyderabad' | 'dallas' | 'phoenix' | 'las_vegas';
export type WeatherType = 'clear' | 'cloudy' | 'overcast' | 'storm';

export interface Location {
	id: LocationId;
	name: string;
	lat: number;
	lon: number;
	utcOffset: number; // Hours offset from UTC (e.g., +5.5 for India, -6 for Dallas)
	hasBuildings: boolean;
	defaultAltitude: number;
}

export const LOCATIONS: Location[] = [
	{ id: 'dubai', name: 'Dubai', lat: 25.2048, lon: 55.2708, utcOffset: 4, hasBuildings: true, defaultAltitude: 28000 },
	{ id: 'mumbai', name: 'Mumbai', lat: 19.076, lon: 72.8777, utcOffset: 5.5, hasBuildings: true, defaultAltitude: 30000 },
	{ id: 'hyderabad', name: 'Hyderabad', lat: 17.4435, lon: 78.3772, utcOffset: 5.5, hasBuildings: true, defaultAltitude: 28000 },
	{ id: 'dallas', name: 'Dallas', lat: 32.7767, lon: -96.7970, utcOffset: -6, hasBuildings: true, defaultAltitude: 32000 },
	{ id: 'phoenix', name: 'Phoenix', lat: 33.4352, lon: -112.0101, utcOffset: -7, hasBuildings: true, defaultAltitude: 30000 },
	{ id: 'las_vegas', name: 'Las Vegas', lat: 36.1699, lon: -115.1398, utcOffset: -8, hasBuildings: true, defaultAltitude: 28000 },
	{ id: 'himalayas', name: 'Himalayas', lat: 27.9881, lon: 86.925, utcOffset: 5.75, hasBuildings: false, defaultAltitude: 38000 },
	{ id: 'ocean', name: 'Pacific Ocean', lat: 21.3069, lon: -157.8583, utcOffset: -10, hasBuildings: false, defaultAltitude: 40000 },
	{ id: 'desert', name: 'Sahara Desert', lat: 23.4241, lon: 25.6628, utcOffset: 2, hasBuildings: false, defaultAltitude: 35000 },
	{ id: 'clouds', name: 'Above Clouds', lat: 35.6762, lon: 139.6503, utcOffset: 9, hasBuildings: false, defaultAltitude: 45000 },
];

// ============================================================================
// STORAGE
// ============================================================================

const STORAGE_KEY = 'aero-window-v2';

interface PersistedState {
	location: LocationId;
	altitude: number;
	weather: WeatherType;
	cloudDensity: number;
	showBuildings: boolean;
	showClouds: boolean;
	syncToRealTime: boolean;
}

function loadPersistedState(): Partial<PersistedState> {
	if (typeof window === 'undefined') return {};
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		return saved ? JSON.parse(saved) : {};
	} catch (error) {
		console.error('Failed to load persisted state:', error);
		return {};
	}
}

function savePersistedState(state: PersistedState): void {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch (error) {
		console.error('Failed to save state:', error);
	}
}

// ============================================================================
// MODEL
// ============================================================================

export class WindowModel {
	// --- Position (authoritative) ---
	lat = $state(25.2048);
	lon = $state(55.2708);
	utcOffset = $state(4); // Hours from UTC (Dubai default)
	altitude = $state(35000);
	heading = $state(45);
	pitch = $state(75);

	// --- Time ---
	timeOfDay = $state(12);
	syncToRealTime = $state(true);

	// --- Location ---
	location = $state<LocationId>('dubai');

	// --- Environment ---
	weather = $state<WeatherType>('cloudy');
	cloudDensity = $state(0.6);
	visibility = $state(35);
	haze = $state(0.025); // Reduced 10x for clearer view

	// --- View ---
	blindOpen = $state(true);
	showBuildings = $state(true);
	showClouds = $state(true);

	// --- Night rendering ---
	nightLightIntensity = $state(2.5);
	terrainDarkness = $state(0.60); // Balanced default (was 0.95 = too dark)

	// --- Flight speed (drift rate multiplier) ---
	flightSpeed = $state(1.0); // 0.5 = slow scenic, 1.0 = normal, 3.0 = fast

	// --- Aircraft Systems (animation state) ---
	strobeOn = $state(false);
	private strobeTimer = 0;

	// --- Weather Effects (animation state) ---
	lightningIntensity = $state(0);
	private lightningTimer = 0;
	private nextLightning = Math.random() * (AIRCRAFT.LIGHTNING_MAX_INTERVAL - AIRCRAFT.LIGHTNING_MIN_INTERVAL) + AIRCRAFT.LIGHTNING_MIN_INTERVAL;

	// --- Motion (computed by tick) ---
	motionOffsetX = $state(0);
	motionOffsetY = $state(0);
	motionOffsetZ = $state(0);
	motionPitch = $state(0);
	motionYaw = $state(0);
	motionRoll = $state(0);

	// --- Flight Transition ---
	isTransitioning = $state(false);
	transitionDestination = $state<string | null>(null);

	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Used internally in flyTo()
	_transitionPhase: 'idle' | 'ascending' | 'cruise' | 'descending' = 'idle';
	_transitionTarget: Location | null = null;
	_transitionStartAlt = 0;
	_transitionProgress = 0;

	// --- Animation time (public for plugins) ---
	time = 0;

	// ========================================================================
	// DERIVED (pure computations)
	// ========================================================================

	// Local time at current location (using proper UTC offset)
	localTimeOfDay = $derived.by(() => {
		if (!this.syncToRealTime) return this.timeOfDay;
		// Convert browser local time to UTC, then to destination local time
		const browserTzOffset = new Date().getTimezoneOffset() / -60; // Browser's UTC offset in hours
		const utcHours = this.timeOfDay - browserTzOffset;
		let localTime = (utcHours + this.utcOffset) % 24;
		if (localTime < 0) localTime += 24;
		return localTime;
	});

	skyState = $derived<SkyState>(getSkyState(this.localTimeOfDay));
	sunPosition = $derived<SunPosition>(calculateSunPosition(this.localTimeOfDay, this.lat));
	biomeColors = $derived<BiomeColors>(getBiomeColors(this.location, this.skyState));
	altitudeMeters = $derived(this.altitude * 0.3048);
	mapZoom = $derived(Math.max(10, Math.min(18, 18 - Math.log2(this.altitude / 500))));

	// Weather-derived
	turbulenceLevel = $derived<'light' | 'moderate' | 'severe'>(
		this.weather === 'storm' ? 'severe' : this.weather === 'overcast' ? 'moderate' : 'light'
	);
	cloudBase = $derived(this.weather === 'storm' ? 20000 : this.weather === 'overcast' ? 12000 : 8000);
	showRain = $derived((this.weather === 'storm' || this.weather === 'overcast') && this.altitude < this.cloudBase);
	showLightning = $derived(this.weather === 'storm');

	// Effective cloud density (user setting + weather adjustment)
	effectiveCloudDensity = $derived(
		this.weather === 'storm' ? Math.max(this.cloudDensity, 0.85) :
		this.weather === 'overcast' ? Math.max(this.cloudDensity, 0.7) :
		this.weather === 'cloudy' ? Math.max(this.cloudDensity, 0.4) :
		this.cloudDensity * 0.3 // Clear weather = sparse clouds
	);

	// Ambient intensity affected by weather
	weatherAmbientReduction = $derived(
		this.weather === 'storm' ? 0.6 :
		this.weather === 'overcast' ? 0.8 :
		1.0
	);

	// Lighting-derived
	showNavLights = $derived(this.skyState === 'night' || this.skyState === 'dusk' || this.skyState === 'dawn');
	navLightIntensity = $derived(this.skyState === 'night' ? 1.0 : this.skyState === 'dusk' || this.skyState === 'dawn' ? 0.7 : 0.3);
	sunIntensity = $derived(this.skyState === 'day' ? 0.8 : this.skyState === 'dawn' || this.skyState === 'dusk' ? 0.5 : 0.1);
	ambientIntensity = $derived(this.skyState === 'night' ? 0.15 : 0.4);

	// ========================================================================
	// CONSTRUCTOR
	// ========================================================================

	constructor() {
		// Load persisted state
		const saved = loadPersistedState();
		if (saved.location) {
			const loc = LOCATIONS.find(l => l.id === saved.location);
			if (loc) {
				this.location = saved.location;
				this.lat = loc.lat;
				this.lon = loc.lon;
				this.utcOffset = loc.utcOffset;
			}
		}
		if (saved.altitude !== undefined) this.altitude = saved.altitude;
		if (saved.weather) this.weather = saved.weather;
		if (saved.cloudDensity !== undefined) this.cloudDensity = saved.cloudDensity;
		if (saved.showBuildings !== undefined) this.showBuildings = saved.showBuildings;
		if (saved.showClouds !== undefined) this.showClouds = saved.showClouds;
		if (saved.syncToRealTime !== undefined) this.syncToRealTime = saved.syncToRealTime;

		// Set initial time
		if (typeof window !== 'undefined') {
			const now = new Date();
			this.timeOfDay = now.getHours() + now.getMinutes() / 60;
		}

		// Real-time sync
		$effect(() => {
			if (this.syncToRealTime && typeof window !== 'undefined') {
				const update = () => {
					const now = new Date();
					this.timeOfDay = now.getHours() + now.getMinutes() / 60;
				};
				const interval = setInterval(update, AIRCRAFT.REAL_TIME_SYNC_INTERVAL);
				return () => clearInterval(interval);
			}
			return undefined;
		});

		// Auto-save
		$effect(() => {
			savePersistedState({
				location: this.location,
				altitude: this.altitude,
				weather: this.weather,
				cloudDensity: this.cloudDensity,
				showBuildings: this.showBuildings,
				showClouds: this.showClouds,
				syncToRealTime: this.syncToRealTime,
			});
		});
	}

	// ========================================================================
	// ACTIONS (state transitions)
	// ========================================================================

	setLocation(locationId: LocationId): void {
		const loc = LOCATIONS.find(l => l.id === locationId);
		if (!loc) return;
		this.location = locationId;
		this.lat = loc.lat;
		this.lon = loc.lon;
		this.utcOffset = loc.utcOffset;
	}

	setAltitude(alt: number): void {
		this.altitude = Math.max(AIRCRAFT.MIN_ALTITUDE, Math.min(AIRCRAFT.MAX_ALTITUDE, alt));
	}

	setTime(time: number): void {
		this.timeOfDay = Math.max(AIRCRAFT.MIN_TIME, Math.min(AIRCRAFT.MAX_TIME, time));
	}

	setWeather(weather: WeatherType): void {
		this.weather = weather;
	}

	toggleBlind(): void {
		this.blindOpen = !this.blindOpen;
	}

	toggleBuildings(): void {
		this.showBuildings = !this.showBuildings;
	}

	toggleClouds(): void {
		this.showClouds = !this.showClouds;
	}

	// ========================================================================
	// FLIGHT TRANSITION (async state machine)
	// ========================================================================

	async flyTo(locationId: LocationId): Promise<void> {
		if (this.isTransitioning) return;

		const target = LOCATIONS.find(l => l.id === locationId);
		if (!target) return;

		this.isTransitioning = true;
		this.transitionDestination = target.name;
		this._transitionTarget = target;
		this._transitionStartAlt = this.altitude;
		this._transitionProgress = 0;

		if (this.blindOpen) {
			this.blindOpen = false;
			await this.wait(AIRCRAFT.TRANSITION_BLIND_DELAY);
		}

		this._transitionPhase = 'ascending';
		await this.animateAltitude(AIRCRAFT.TRANSITION_TARGET_ALTITUDE, AIRCRAFT.TRANSITION_ASCEND_DURATION);

		this._transitionPhase = 'cruise';
		await this.wait(AIRCRAFT.TRANSITION_CRUISE_DURATION);
		this.setLocation(locationId);
		await this.wait(AIRCRAFT.TRANSITION_CRUISE_DURATION);

		this._transitionPhase = 'descending';
		await this.animateAltitude(target.defaultAltitude, AIRCRAFT.TRANSITION_DESCEND_DURATION);

		await this.wait(AIRCRAFT.TRANSITION_BLIND_DELAY);
		this.blindOpen = true;

		this._transitionPhase = 'idle';
		this.isTransitioning = false;
		this.transitionDestination = null;
		this._transitionTarget = null;
	}

	private wait(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	private animateAltitude(target: number, duration: number): Promise<void> {
		return new Promise(resolve => {
			const start = this.altitude;
			const startTime = performance.now();

			const update = () => {
				const elapsed = performance.now() - startTime;
				const progress = Math.min(elapsed / duration, 1);
				this.altitude = start + (target - start) * easeInOutCubic(progress);

				if (progress < 1) {
					requestAnimationFrame(update);
				} else {
					resolve();
				}
			};
			requestAnimationFrame(update);
		});
	}

	// ========================================================================
	// TICK (single animation update for all time-based state)
	// ========================================================================

	tick(delta: number): void {
		this.time += delta;

		// --- Dynamic flight drift (layered noise for natural movement) ---
		if (!this.isTransitioning) {
			const baseDrift = AIRCRAFT.DRIFT_RATE * this.flightSpeed;
			const headingRad = (this.heading * Math.PI) / 180;
			this.lat += Math.cos(headingRad) * baseDrift * delta;
			this.lon += Math.sin(headingRad) * baseDrift * delta;

			const wander1 = Math.sin(this.time * AIRCRAFT.WANDER_SLOW) * AIRCRAFT.WANDER_RANGE_SLOW;
			const wander2 = Math.sin(this.time * AIRCRAFT.WANDER_MEDIUM) * AIRCRAFT.WANDER_RANGE_MEDIUM;
			const wander3 = Math.sin(this.time * AIRCRAFT.WANDER_FAST) * AIRCRAFT.WANDER_RANGE_FAST;
			this.heading += (wander1 + wander2 + wander3) * delta * this.flightSpeed;

			const bankTrigger = Math.sin(this.time * AIRCRAFT.BANK_TRIGGER_FREQ);
			if (Math.abs(bankTrigger) > AIRCRAFT.BANK_THRESHOLD) {
				this.heading += (bankTrigger > 0 ? AIRCRAFT.BANK_AMOUNT : -AIRCRAFT.BANK_AMOUNT) * delta * this.flightSpeed;
			}

			// Normalize heading to 0-360 range
			this.heading = ((this.heading % 360) + 360) % 360;
		}

		this.strobeTimer += delta;
		if (this.strobeTimer > AIRCRAFT.STROBE_INTERVAL) {
			this.strobeOn = !this.strobeOn;
			this.strobeTimer = this.strobeOn ? AIRCRAFT.STROBE_INTERVAL - AIRCRAFT.STROBE_DURATION : 0;
		}

		if (this.showLightning) {
			this.lightningTimer += delta;

			if (this.lightningIntensity > 0) {
				this.lightningIntensity = Math.max(0, this.lightningIntensity - delta * AIRCRAFT.LIGHTNING_DECAY_RATE);
			}

			if (this.lightningIntensity === 0 && this.lightningTimer > this.nextLightning) {
				this.lightningIntensity = 0.5 + Math.random() * 0.5;
				this.lightningTimer = 0;
				this.nextLightning = Math.random() * (AIRCRAFT.LIGHTNING_MAX_INTERVAL - AIRCRAFT.LIGHTNING_MIN_INTERVAL) + AIRCRAFT.LIGHTNING_MIN_INTERVAL;
			}
		} else {
			this.lightningIntensity = 0;
		}

		const t = this.time;
		const turbMult = AIRCRAFT.TURBULENCE_MULTIPLIERS[this.turbulenceLevel];

		const vibration = Math.sin(t * AIRCRAFT.VIBRATION_FREQ_1) * 0.0003 + Math.sin(t * AIRCRAFT.VIBRATION_FREQ_2) * 0.0002;

		const turbX = (Math.sin(t * 0.7) * 0.15 + Math.sin(t * 1.3) * 0.1) * turbMult;
		const turbY = (Math.sin(t * 0.5) * 0.1 + Math.sin(t * 1.1) * 0.08) * turbMult;
		const turbZ = (Math.sin(t * 0.9) * 0.12 + Math.sin(t * 1.7) * 0.06) * turbMult;

		this.motionOffsetX = turbX * AIRCRAFT.TURBULENCE_OFFSET_X;
		this.motionOffsetY = vibration + turbY * AIRCRAFT.TURBULENCE_OFFSET_Y;
		this.motionOffsetZ = turbZ * AIRCRAFT.TURBULENCE_OFFSET_Z;

		this.motionPitch = Math.sin(t * 0.3) * AIRCRAFT.MOTION_PITCH_SCALE * turbMult;
		this.motionRoll = Math.sin(t * 0.4) * AIRCRAFT.MOTION_ROLL_SCALE * turbMult;
		this.motionYaw = Math.sin(t * 0.2) * AIRCRAFT.MOTION_YAW_SCALE * turbMult;
	}
}
