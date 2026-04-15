/**
 * WindowModel — authoritative reactive simulation state + Svelte context DI.
 *
 * Usage:
 *   Root component: const model = createAppState()
 *   Child components: const model = useAppState()
 */

import { setContext, getContext } from 'svelte';
import { clamp, getSkyState } from '$lib/utils';
import { WEATHER_EFFECTS } from '$lib/constants';
import { QUALITY_MODES } from '$lib/types';
import type { SkyState, LocationId, WeatherType, QualityMode, DisplayMode, SimulationContext } from '$lib/types';
import { loadPersistedState, type PersistedState } from '$lib/persistence';
import { isValidWeather } from '$lib/validation';
import { pickNextLocation } from '$lib/simulation/scenarios';
import { LOCATIONS, LOCATION_MAP } from '$lib/locations';
import { FlightSimEngine } from '$lib/simulation/flight.svelte';
import { MotionEngine } from '$lib/simulation/motion.svelte';
import { WorldEngine } from '$lib/simulation/world.svelte';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PatchableState {
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
	showBuildings: boolean;
}

// ─── UserOverrideTracker ─────────────────────────────────────────────────────

/** Tracks short-lived user interaction flags that pause auto-behaviors. */
class UserOverrideTracker {
	altitude   = $state(false);
	time       = $state(false);
	atmosphere = $state(false);

	#timers: { altitude?: ReturnType<typeof setTimeout>; time?: ReturnType<typeof setTimeout>; atmosphere?: ReturnType<typeof setTimeout> } = {};

	track(type: 'altitude' | 'time' | 'atmosphere', durationMs = 8000): void {
		this[type] = true;
		const existing = this.#timers[type];
		if (existing) clearTimeout(existing);
		this.#timers[type] = setTimeout(() => { this[type] = false; }, durationMs);
	}

	destroy(): void {
		clearTimeout(this.#timers.altitude);
		clearTimeout(this.#timers.time);
		clearTimeout(this.#timers.atmosphere);
		this.#timers = {};
	}
}

// ─── WindowModel ─────────────────────────────────────────────────────────────

export class WindowModel {
	// ── Engines ───────────────────────────────────────────────────────────────
	readonly flight = new FlightSimEngine();
	readonly motion = new MotionEngine();
	readonly world  = new WorldEngine();

	// ── Core state ────────────────────────────────────────────────────────────
	location     = $state<LocationId>('dubai');
	timeOfDay    = $state(12);
	syncToRealTime = $state(true);

	// Environment
	weather             = $state<WeatherType>('cloudy');
	cloudDensity        = $state(0.7);
	cloudSpeed          = $state(0.4);
	haze                = $state(0.025);
	nightLightIntensity = $state(0.6);

	// View
	blindOpen     = $state(true);
	showBuildings = $state(true);
	showClouds    = $state(true);

	// Display — fleet-controlled mode. Stored and relayed via fleet status/push.
	// Window.svelte does not consume this yet; add a display-path consumer here
	// when screensaver/video modes are implemented.
	displayMode = $state<DisplayMode>('flight');
	videoUrl    = $state('');

	// Performance
	qualityMode = $state<QualityMode>('balanced');
	autoQuality = $state(true);
	measuredFps = $state(0);

	// User-interaction override tracker (pauses auto-behavior for 8 s)
	readonly #overrides = new UserOverrideTracker();
	get userAdjustingAltitude()   { return this.#overrides.altitude; }
	get userAdjustingTime()       { return this.#overrides.time; }
	get userAdjustingAtmosphere() { return this.#overrides.atmosphere; }

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

	nightFactor = $derived.by(() => {
		const t = this.timeOfDay;
		if (t >= 7 && t <= 18) return 0;
		if (t < 5 || t > 20) return 1;
		if (t < 7) return 1 - (t - 5) / 2;
		return (t - 18) / 2;
	});

	dawnDuskFactor = $derived.by(() => {
		const t = this.timeOfDay;
		if (t >= 7 && t <= 18) return 0;
		if (t < 5 || t > 22) return 0;
		if (t < 7) return (t - 5) / 2;
		if (t > 18) return (22 - t) / 4;
		return 0;
	});

	nightLightScale = $derived(this.nightLightIntensity);

	effectiveCloudDensity = $derived.by(() => {
		const fx = WEATHER_EFFECTS[this.weather];
		const [min, max] = fx.cloudDensityRange;
		let d = max > 0 ? clamp(this.cloudDensity, min, max) : this.cloudDensity * 0.3;
		if (this.skyState === 'night') d = Math.max(d * 0.5, fx.nightCloudFloor);
		else if (this.skyState === 'dusk') d *= 0.7;
		return d;
	});

	// ── Constructor ───────────────────────────────────────────────────────────
	constructor() {
		this.#applyPersisted(loadPersistedState());

		if (typeof window !== 'undefined') {
			this.#fpsLastTime = performance.now();
			const now = new Date();
			this.timeOfDay = now.getHours() + now.getMinutes() / 60;
		}
	}

	#applyPersisted(saved: Partial<PersistedState>): void {
		if (saved.location)            this.setLocation(saved.location);
		if (saved.altitude !== undefined) this.flight.altitude = saved.altitude;
		if (saved.weather)             this.weather = saved.weather;
		if (saved.cloudDensity !== undefined) this.cloudDensity = saved.cloudDensity;
		this.showBuildings = saved.showBuildings ?? true;
		this.showClouds    = saved.showClouds    ?? true;
		this.syncToRealTime = saved.syncToRealTime ?? true;
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	setLocation(id: LocationId): void {
		this.location = id;
		this.flight.setLocationWithSky(id, this.skyState);
		// Apply per-location scene defaults
		const scene = this.currentLocation.scene;
		this.cloudDensity = scene.clouds.density;
		this.cloudSpeed = scene.clouds.speed;
	}

	setAltitude(alt: number): void {
		this.flight.setAltitude(alt);
		this.onUserInteraction('altitude');
	}

	setTime(t: number): void {
		this.timeOfDay = clamp(t, 0, 24);
		this.onUserInteraction('time');
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

	toggleBuildings(): void {
		this.showBuildings = !this.showBuildings;
	}

	setDisplayMode(mode: DisplayMode, payload?: string): void {
		this.displayMode = mode;
		if (payload && mode === 'video') this.videoUrl = payload;
	}

	applyScene(locationId: LocationId, weather?: WeatherType): void {
		this.flight.flyTo(locationId);
		if (weather) this.weather = weather;
	}

	setQualityMode(mode: QualityMode): void {
		this.qualityMode = mode;
	}

	applyPatch(patch: Partial<PatchableState>): void {
		if (patch.altitude !== undefined)           this.setAltitude(patch.altitude);
		if (patch.timeOfDay !== undefined)          this.setTime(patch.timeOfDay);
		if (patch.weather !== undefined && isValidWeather(patch.weather)) {
			this.weather = patch.weather;
			this.onUserInteraction('atmosphere');
		}
		if (patch.cloudDensity !== undefined)       { this.cloudDensity = clamp(patch.cloudDensity, 0, 1); this.onUserInteraction('atmosphere'); }
		if (patch.cloudSpeed !== undefined)         this.cloudSpeed = clamp(patch.cloudSpeed, 0, 2);
		if (patch.haze !== undefined)               this.haze = clamp(patch.haze, 0, 0.2);
		if (patch.nightLightIntensity !== undefined) this.nightLightIntensity = clamp(patch.nightLightIntensity, 0, 5);
		if (patch.flightSpeed !== undefined)        this.flight.flightSpeed = clamp(patch.flightSpeed, 0.1, 5);
		if (patch.syncToRealTime !== undefined && typeof patch.syncToRealTime === 'boolean') this.syncToRealTime = patch.syncToRealTime;
		if (patch.showClouds !== undefined && typeof patch.showClouds === 'boolean') this.showClouds = patch.showClouds;
		if (patch.showBuildings !== undefined && typeof patch.showBuildings === 'boolean') this.showBuildings = patch.showBuildings;
	}

	onUserInteraction(type: 'altitude' | 'time' | 'atmosphere'): void {
		this.#overrides.track(type);
	}

	getPersistedSnapshot(): PersistedState {
		return {
			location: this.location, altitude: this.flight.altitude, weather: this.weather,
			cloudDensity: this.cloudDensity, showBuildings: this.showBuildings,
			showClouds: this.showClouds, syncToRealTime: this.syncToRealTime,
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
		this.time = (this.time + delta) % 3600;

		const ctx = this.#createContext();

		const flightPatch = this.flight.tick(delta, ctx);
		if (flightPatch.blindOpen !== undefined) this.blindOpen = flightPatch.blindOpen;
		if (flightPatch.locationArrived)         this.setLocation(flightPatch.locationArrived);
		if (flightPatch.resetDirector)           this.world.resetDirector();

		this.motion.tick(delta, ctx);

		ctx.isOrbitMode      = this.flight.flightMode === 'orbit';
		ctx.pickNextLocation = () => pickNextLocation(this.location, this.timeOfDay);
		const worldPatch = this.world.tick(delta, ctx);

		if (worldPatch.atmosphere) this.applyPatch(worldPatch.atmosphere);
		if (worldPatch.nextLocation) this.flight.flyTo(worldPatch.nextLocation);

		if (this.autoQuality) this.#tickAutoQuality(delta);
	}

	// Reuse a single context object each frame — avoids per-frame GC pressure
	#ctx: SimulationContext = {
		time: 0, lat: 0, lon: 0, altitude: 0, heading: 0, pitch: 0, bankAngle: 0,
		weather: 'cloudy', skyState: 'day', nightFactor: 0, dawnDuskFactor: 0,
		locationId: 'dubai', userAdjustingAltitude: false, userAdjustingTime: false,
		userAdjustingAtmosphere: false, cloudDensity: 0, cloudSpeed: 0, haze: 0,
		turbulenceLevel: 'light',
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
		c.cloudDensity          = this.cloudDensity;
		c.cloudSpeed            = this.cloudSpeed;
		c.haze                  = this.haze;
		c.turbulenceLevel       = WEATHER_EFFECTS[this.weather].turbulence;
		return c;
	}

	#tickAutoQuality(delta: number): void {
		if (this.measuredFps === 0) return;
		this.#qualityCheckTimer += delta;
		if (this.#qualityCheckTimer < 5) return;
		this.#qualityCheckTimer = 0;

		const idx = QUALITY_MODES.indexOf(this.qualityMode);
		if (this.measuredFps < 20 && idx > 0)               this.qualityMode = QUALITY_MODES[idx - 1];
		else if (this.measuredFps > 40 && idx < QUALITY_MODES.length - 1) this.qualityMode = QUALITY_MODES[idx + 1];
	}

	destroy(): void {
		this.#overrides.destroy();
	}
}

// ─── Context DI ──────────────────────────────────────────────────────────────

const APP_STATE_KEY = Symbol('APP_STATE');

export function createAppState(): WindowModel {
	const model = new WindowModel();
	setContext(APP_STATE_KEY, model);
	return model;
}

export function useAppState(): WindowModel {
	const model = getContext<WindowModel>(APP_STATE_KEY);
	if (!model) throw new Error('useAppState() called outside component tree');
	return model;
}
