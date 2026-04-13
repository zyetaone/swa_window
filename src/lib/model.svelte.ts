/**
 * WindowModel - Single Source of Truth
 */

import { clamp } from '$lib/shared/utils';
import { AIRCRAFT, WEATHER_EFFECTS } from '$lib/shared/constants';
import { LOCATION_MAP, LOCATIONS } from '$lib/shared/locations';
import type { SkyState, LocationId, WeatherType } from '$lib/shared/types';
import type { DisplayMode, DisplayConfig } from '$lib/shared/protocol';
import { loadPersistedState, type QualityMode, type PersistedState } from '$lib/services/persistence';
import { FlightSimEngine } from '$lib/engine/flight.svelte';
import { MotionEngine } from '$lib/engine/motion.svelte';
import { EventEngine } from '$lib/engine/events.svelte';
import { DirectorEngine } from '$lib/engine/director.svelte';
import { AtmosphereEngine } from '$lib/engine/atmosphere.svelte';
import type { SimulationContext } from '$lib/engine/types';

export type { QualityMode } from '$lib/services/persistence';
export type { FlightMode } from '$lib/engine/flight.svelte';

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

function getSkyState(timeOfDay: number): SkyState {
	if (timeOfDay < 5 || timeOfDay >= 20) return 'night';
	if (timeOfDay < 7) return 'dawn';
	if (timeOfDay >= 18) return 'dusk';
	return 'day';
}

export class WindowModel {
	// ========================================================================
	// ENGINES
	// ========================================================================
	readonly flight = new FlightSimEngine({
		setBlindOpen: (open) => { this.blindOpen = open; },
		resetDirector: () => { this.director.reset(); },
		onLocationChanged: (id) => { this.setLocation(id); },
		resetBankAngle: () => {},
	});

	readonly motion = new MotionEngine();
	readonly atmosphere = new AtmosphereEngine();
	readonly events = new EventEngine();
	readonly director = new DirectorEngine();

	// ========================================================================
	// CORE STATE
	// ========================================================================
	location = $state<LocationId>('dubai');
	timeOfDay = $state(12);
	syncToRealTime = $state(true);

	// Environment
	weather = $state<WeatherType>('cloudy');
	cloudDensity = $state(0.7);
	cloudSpeed = $state(0.4);
	haze = $state(0.025);
	terrainDarkness = $state(0);
	nightLightIntensity = $state(0.6);

	// View
	blindOpen = $state(true);
	showBuildings = $state(true);
	showClouds = $state(true);

	// Display Mode
	displayMode = $state<DisplayMode>('flight');
	videoUrl = $state('');

	// Performance
	qualityMode = $state<QualityMode>('balanced');
	autoQuality = $state(true);
	measuredFps = $state(0);

	// User Interaction
	userAdjustingAltitude = $state(false);
	userAdjustingTime = $state(false);
	userAdjustingAtmosphere = $state(false);

	// Animation time
	time = 0;

	// Internal timing (#private)
	#userOverrideTimeout: ReturnType<typeof setTimeout> | null = null;
	#frameCount = 0;
	#fpsLastTime = 0;
	#qualityCheckTimer = 0;

	// ========================================================================
	// DERIVED
	// ========================================================================
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

	constructor() {
		const saved = loadPersistedState();
		this.#applyPersisted(saved);

		if (typeof window !== 'undefined') {
			this.#fpsLastTime = performance.now();
			const now = new Date();
			this.timeOfDay = now.getHours() + now.getMinutes() / 60;
		}
	}

	#applyPersisted(saved: PersistedState): void {
		if (saved.location) this.setLocation(saved.location);
		if (saved.altitude !== undefined) this.flight.altitude = saved.altitude;
		if (saved.weather) this.weather = saved.weather;
		if (saved.cloudDensity !== undefined) this.cloudDensity = saved.cloudDensity;
		this.showBuildings = saved.showBuildings ?? true;
		this.showClouds = saved.showClouds ?? true;
		this.syncToRealTime = saved.syncToRealTime ?? true;
	}

	// ========================================================================
	// ACTIONS
	// ========================================================================
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

	getPersistedSnapshot(): PersistedState {
		return {
			location: this.location,
			altitude: this.flight.altitude,
			weather: this.weather,
			cloudDensity: this.cloudDensity,
			showBuildings: this.showBuildings,
			showClouds: this.showClouds,
			syncToRealTime: this.syncToRealTime
		};
	}

	pickNextLocation(): LocationId {
		return this.flight.pickNextLocation(this.timeOfDay, this.location);
	}

	setDisplayMode(mode: DisplayMode, payload?: string): void {
		this.displayMode = mode;
		if (payload && mode === 'video') this.videoUrl = payload;
	}

	applyPatch(patch: Partial<PatchableState>): void {
		if (patch.altitude !== undefined) this.setAltitude(patch.altitude);
		if (patch.timeOfDay !== undefined) this.setTime(patch.timeOfDay);
		if (patch.weather !== undefined) this.weather = patch.weather;
		if (patch.cloudDensity !== undefined) {
			this.cloudDensity = clamp(patch.cloudDensity, 0, 1);
			this.onUserInteraction('atmosphere');
		}
		if (patch.cloudSpeed !== undefined) this.cloudSpeed = clamp(patch.cloudSpeed, 0, 2);
		if (patch.haze !== undefined) this.haze = clamp(patch.haze, 0, 0.2);
		if (patch.terrainDarkness !== undefined) this.terrainDarkness = clamp(patch.terrainDarkness, 0, 1);
		if (patch.nightLightIntensity !== undefined) this.nightLightIntensity = clamp(patch.nightLightIntensity, 0, 5);
		if (patch.flightSpeed !== undefined) this.flight.flightSpeed = clamp(patch.flightSpeed, 0.1, 5);
		if (patch.syncToRealTime !== undefined) this.syncToRealTime = patch.syncToRealTime;
		if (patch.showClouds !== undefined) this.showClouds = patch.showClouds;
		if (patch.showBuildings !== undefined) this.showBuildings = patch.showBuildings;
	}

	onUserInteraction(type: 'altitude' | 'time' | 'atmosphere'): void {
		if (type === 'altitude') this.userAdjustingAltitude = true;
		else if (type === 'time') this.userAdjustingTime = true;
		else if (type === 'atmosphere') this.userAdjustingAtmosphere = true;

		if (this.#userOverrideTimeout) clearTimeout(this.#userOverrideTimeout);
		this.#userOverrideTimeout = setTimeout(() => {
			this.userAdjustingAltitude = false;
			this.userAdjustingTime = false;
			this.userAdjustingAtmosphere = false;
		}, 8000);
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

	// ========================================================================
	// TICK PIPELINE
	// ========================================================================
	tick(delta: number): void {
		if (!Number.isFinite(delta) || delta <= 0 || delta > 0.1) return;
		this.time = (this.time + delta) % 3600;

		const ctx = this.#createContext();

		this.flight.tick(delta, ctx);
		this.motion.tick(delta, { ...ctx, turbulenceLevel: WEATHER_EFFECTS[this.weather].turbulence });
		this.events.tick(delta, ctx);

		const atmospherePatch = this.atmosphere.tick(delta, {
			...ctx,
			showLightning: WEATHER_EFFECTS[this.weather].hasLightning
		});
		if (atmospherePatch) this.applyPatch(atmospherePatch);

		if (this.flight.flightMode === 'orbit') {
			const nextId = this.director.tick(delta, {
				...ctx,
				pickNextLocation: () => this.flight.pickNextLocation(this.timeOfDay, this.location)
			});
			if (nextId) this.flight.flyTo(nextId);
		}

		if (this.autoQuality) this.#tickAutoQuality(delta);
	}

	#ctx: SimulationContext = {
		time: 0, lat: 0, lon: 0, altitude: 0, heading: 0, pitch: 0, bankAngle: 0,
		weather: 'cloudy', skyState: 'day', nightFactor: 0, dawnDuskFactor: 0,
		locationId: 'dubai', userAdjustingAltitude: false, userAdjustingTime: false,
		userAdjustingAtmosphere: false, cloudDensity: 0, cloudSpeed: 0, haze: 0
	};

	#createContext(): SimulationContext {
		const c = this.#ctx;
		c.time = this.time;
		c.lat = this.flight.lat;
		c.lon = this.flight.lon;
		c.altitude = this.flight.altitude;
		c.heading = this.flight.heading;
		c.pitch = this.flight.pitch;
		c.bankAngle = this.motion.bankAngle;
		c.weather = this.weather;
		c.skyState = this.skyState;
		c.nightFactor = this.nightFactor;
		c.locationId = this.location;
		c.userAdjustingAltitude = this.userAdjustingAltitude;
		c.userAdjustingTime = this.userAdjustingTime;
		c.userAdjustingAtmosphere = this.userAdjustingAtmosphere;
		c.cloudDensity = this.cloudDensity;
		c.cloudSpeed = this.cloudSpeed;
		c.haze = this.haze;
		return c;
	}

	#tickAutoQuality(delta: number): void {
		if (this.measuredFps === 0) return;
		this.#qualityCheckTimer += delta;
		if (this.#qualityCheckTimer < 5) return;
		this.#qualityCheckTimer = 0;

		const modes: QualityMode[] = ['performance', 'balanced', 'ultra'];
		const idx = modes.indexOf(this.qualityMode);
		if (this.measuredFps < 20 && idx > 0) this.qualityMode = modes[idx - 1];
		else if (this.measuredFps > 40 && idx < modes.length - 1) this.qualityMode = modes[idx + 1];
	}

	destroy(): void {
		if (this.#userOverrideTimeout) clearTimeout(this.#userOverrideTimeout);
	}
}
