/**
 * app-state.svelte.ts — Single Source of Truth + Context DI
 *
 * Unifies what was previously two files (model.svelte.ts + context.ts):
 *   - WindowModel class: authoritative reactive simulation state
 *   - createAppState / useAppState: Svelte context injection
 *
 * Usage:
 *   Root component: const model = createAppState()
 *   Child components: const model = useAppState()
 */

import { setContext, getContext } from 'svelte';
import { clamp } from '$lib/shared/utils';
import { WEATHER_EFFECTS } from '$lib/shared/constants';
import type { QualityMode } from '$lib/shared/constants';
import type { SkyState, LocationId, WeatherType } from '$lib/shared/types';
import type { DisplayMode } from '$lib/shared/protocol';
import { loadPersistedState, type PersistedState } from '$lib/services/persistence';
import { pickNextLocation } from '$lib/engine/flight-scenarios';
import { FlightSimEngine } from '$lib/engine/flight-engine.svelte';
import { MotionEngine } from '$lib/engine/motion-engine.svelte';
import { WorldEngine } from '$lib/engine/world-engine.svelte';
import type { SimulationContext } from '$lib/engine/types';

// ─── Re-exports (barrel — keeps all consumer imports pointing here) ───────────

export { AIRCRAFT, CESIUM, FLIGHT_FEEL, WEATHER_EFFECTS, AMBIENT, MICRO_EVENTS, CESIUM_QUALITY_PRESETS } from '$lib/shared/constants';
export type { WeatherEffect, QualityMode } from '$lib/shared/constants';
export { LOCATIONS, LOCATION_IDS, LOCATION_MAP } from '$lib/shared/locations';
export { clamp, lerp, normalizeHeading, formatTime } from '$lib/shared/utils';
export type { SkyState, LocationId, WeatherType, Location } from '$lib/shared/types';
export type { FlightMode } from '$lib/engine/flight-engine.svelte';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PatchableState {
	altitude: number;
	timeOfDay: number;
	weather: WeatherType;
	cloudDensity: number;
	terrainDarkness: number;
	cloudSpeed: number;
	haze: number;
	nightLightIntensity: number;
	flightSpeed: number;
	syncToRealTime: boolean;
	showClouds: boolean;
	showBuildings: boolean;
}

// ─── Pure helper ─────────────────────────────────────────────────────────────

function getSkyState(timeOfDay: number): SkyState {
	if (timeOfDay < 5 || timeOfDay >= 20) return 'night';
	if (timeOfDay < 7) return 'dawn';
	if (timeOfDay >= 18) return 'dusk';
	return 'day';
}

// ─── WindowModel ─────────────────────────────────────────────────────────────

export class WindowModel {
	// ── Engines ───────────────────────────────────────────────────────────────
	readonly flight = new FlightSimEngine({
		setBlindOpen:      (open) => { this.blindOpen = open; },
		resetDirector:     () => { this.world.resetDirector(); },
		onLocationChanged: (id) => { this.setLocation(id); },
		resetBankAngle:    () => {},
	});
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
	terrainDarkness     = $state(0);
	nightLightIntensity = $state(0.6);

	// View
	blindOpen     = $state(true);
	showBuildings = $state(true);
	showClouds    = $state(true);

	// Display
	displayMode = $state<DisplayMode>('flight');
	videoUrl    = $state('');

	// Performance
	qualityMode = $state<QualityMode>('balanced');
	autoQuality = $state(true);
	measuredFps = $state(0);

	// User-interaction flags
	userAdjustingAltitude   = $state(false);
	userAdjustingTime       = $state(false);
	userAdjustingAtmosphere = $state(false);

	// High-frequency animation time (not reactive — updated via untrack in game loop)
	time = 0;

	// Private timers
	#userOverrideTimeout: ReturnType<typeof setTimeout> | null = null;
	#frameCount    = 0;
	#fpsLastTime   = 0;
	#qualityCheckTimer = 0;

	// ── Derived ───────────────────────────────────────────────────────────────
	skyState = $derived<SkyState>(getSkyState(this.timeOfDay));

	nightFactor = $derived.by(() => {
		const t = this.timeOfDay;
		if (t >= 7 && t <= 18) return 0;
		if (t < 5 || t > 20) return 1;
		if (t < 7) return 1 - (t - 5) / 2;
		return (t - 18) / 2;
	});

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

	setDisplayMode(mode: DisplayMode, payload?: string): void {
		this.displayMode = mode;
		if (payload && mode === 'video') this.videoUrl = payload;
	}

	applyPatch(patch: Partial<PatchableState>): void {
		if (patch.altitude !== undefined)           this.setAltitude(patch.altitude);
		if (patch.timeOfDay !== undefined)          this.setTime(patch.timeOfDay);
		if (patch.weather !== undefined)            this.weather = patch.weather;
		if (patch.cloudDensity !== undefined)       { this.cloudDensity = clamp(patch.cloudDensity, 0, 1); this.onUserInteraction('atmosphere'); }
		if (patch.cloudSpeed !== undefined)         this.cloudSpeed = clamp(patch.cloudSpeed, 0, 2);
		if (patch.haze !== undefined)               this.haze = clamp(patch.haze, 0, 0.2);
		if (patch.terrainDarkness !== undefined)    this.terrainDarkness = clamp(patch.terrainDarkness, 0, 1);
		if (patch.nightLightIntensity !== undefined) this.nightLightIntensity = clamp(patch.nightLightIntensity, 0, 5);
		if (patch.flightSpeed !== undefined)        this.flight.flightSpeed = clamp(patch.flightSpeed, 0.1, 5);
		if (patch.syncToRealTime !== undefined)     this.syncToRealTime = patch.syncToRealTime;
		if (patch.showClouds !== undefined)         this.showClouds = patch.showClouds;
		if (patch.showBuildings !== undefined)      this.showBuildings = patch.showBuildings;
	}

	onUserInteraction(type: 'altitude' | 'time' | 'atmosphere'): void {
		if (type === 'altitude')   this.userAdjustingAltitude   = true;
		if (type === 'time')       this.userAdjustingTime       = true;
		if (type === 'atmosphere') this.userAdjustingAtmosphere = true;

		if (this.#userOverrideTimeout) clearTimeout(this.#userOverrideTimeout);
		this.#userOverrideTimeout = setTimeout(() => {
			this.userAdjustingAltitude   = false;
			this.userAdjustingTime       = false;
			this.userAdjustingAtmosphere = false;
		}, 8000);
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

		this.flight.tick(delta, ctx);
		this.motion.tick(delta, { ...ctx, turbulenceLevel: WEATHER_EFFECTS[this.weather].turbulence });

		const worldPatch = this.world.tick(delta, {
			...ctx,
			showLightning:   WEATHER_EFFECTS[this.weather].hasLightning,
			isOrbitMode:     this.flight.flightMode === 'orbit',
			pickNextLocation: () => pickNextLocation(this.location, this.timeOfDay),
		});

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
		c.locationId            = this.location;
		c.userAdjustingAltitude = this.userAdjustingAltitude;
		c.userAdjustingTime     = this.userAdjustingTime;
		c.userAdjustingAtmosphere = this.userAdjustingAtmosphere;
		c.cloudDensity          = this.cloudDensity;
		c.cloudSpeed            = this.cloudSpeed;
		c.haze                  = this.haze;
		return c;
	}

	#tickAutoQuality(delta: number): void {
		if (this.measuredFps === 0) return;
		this.#qualityCheckTimer += delta;
		if (this.#qualityCheckTimer < 5) return;
		this.#qualityCheckTimer = 0;

		const modes: QualityMode[] = ['performance', 'balanced', 'ultra'];
		const idx = modes.indexOf(this.qualityMode);
		if (this.measuredFps < 20 && idx > 0)               this.qualityMode = modes[idx - 1];
		else if (this.measuredFps > 40 && idx < modes.length - 1) this.qualityMode = modes[idx + 1];
	}

	destroy(): void {
		if (this.#userOverrideTimeout) clearTimeout(this.#userOverrideTimeout);
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
