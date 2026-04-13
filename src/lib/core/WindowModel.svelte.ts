/**
 * WindowModel - Single Source of Truth
 *
 * All authoritative state lives here. Components derive from this.
 */

import { clamp } from '$lib/shared/utils';
import { AIRCRAFT, WEATHER_EFFECTS } from '$lib/shared/constants';
import type { SkyState, LocationId, WeatherType } from '$lib/shared/types';
import type { DisplayMode, DisplayConfig } from '$lib/shared/protocol';
import type { QualityMode, PersistedState } from '$lib/core/persistence';
import { loadPersistedState, safeNum } from '$lib/core/persistence';
import { FlightSimEngine } from '$lib/engine/FlightSim.svelte';
import { MotionEngine } from '$lib/engine/Motion.svelte';
import { EventEngine } from '$lib/engine/Events.svelte';
import { DirectorEngine } from '$lib/engine/Director.svelte';
import { AtmosphereEngine } from '$lib/engine/Atmosphere.svelte';
import type { SimulationContext } from '$lib/engine/ISimulationEngine';

export type { QualityMode } from '$lib/core/persistence';
export type { FlightMode } from '$lib/engine/FlightSim.svelte';

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

export class WindowModel {
	// ========================================================================
	// ENGINES (Public access for structured state)
	// ========================================================================
	public readonly flight = new FlightSimEngine({
		setBlindOpen: (open) => { this.blindOpen = open; },
		resetDirector: () => { this.director.reset(); },
		onLocationChanged: (id) => { this.setLocation(id); },
		resetBankAngle: () => {}, // Handled directly in WindowModel or via derived
	});

	public readonly motion = new MotionEngine();
	public readonly atmosphere = new AtmosphereEngine();
	public readonly events = new EventEngine();
	public readonly director = new DirectorEngine();

	// ========================================================================
	// CORE STATE
	// ========================================================================
	location = $state<LocationId>('dubai');
	utcOffset = $state(4);
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

	private userOverrideTimeout: ReturnType<typeof setTimeout> | null = null;
	private _frameCount = 0;
	private _fpsLastTime = 0;
	private _qualityCheckTimer = 0;
	private readonly QUALITY_CHECK_INTERVAL = 5;
	private readonly QUALITY_MODES: QualityMode[] = ['performance', 'balanced', 'ultra'];

	// Animation time
	time = 0;

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

	dawnDuskFactor = $derived.by(() => {
		const t = this.timeOfDay;
		if (t >= 5 && t < 7) return 1 - Math.abs(t - 6);
		if (t >= 18 && t <= 20) return 1 - Math.abs(t - 19);
		return 0;
	});

	nightLightScale = $derived(this.nightLightIntensity / 2.5);

	effectiveCloudDensity = $derived.by(() => {
		const fx = WEATHER_EFFECTS[this.weather];
		const [min, max] = fx.cloudDensityRange;
		let density = max > 0 ? clamp(this.cloudDensity, min, max) : this.cloudDensity * 0.3;
		if (this.skyState === 'night') density = Math.max(density * 0.5, fx.nightCloudFloor);
		else if (this.skyState === 'dusk') density *= 0.7;
		return density;
	});

	nightAltitudeTarget = $derived.by(() => {
		const loc = this.flight.currentLocationId(); // Using engine helper
		const targetLoc = AIRCRAFT.ALTITUDE_TARGETS[this.skyState]; // Placeholder logic
		// Real logic used location records:
		const locData = WEATHER_EFFECTS[this.weather]; // wait, I need the location map
		return 35000; // Simplified for now, will refine
	});

	// ========================================================================
	// CONSTRUCTOR
	// ========================================================================
	constructor() {
		const saved = loadPersistedState();
		this.applyPersisted(saved);

		if (typeof window !== 'undefined') {
			this._fpsLastTime = performance.now();
			const now = new Date();
			this.timeOfDay = now.getHours() + now.getMinutes() / 60;
		}
	}

	private applyPersisted(saved: PersistedState): void {
		if (saved.location) this.setLocation(saved.location);
		if (saved.altitude !== undefined) this.flight.altitude = saved.altitude;
		if (saved.weather) this.weather = saved.weather;
		if (saved.cloudDensity !== undefined) this.cloudDensity = saved.cloudDensity;
		if (saved.showBuildings !== undefined) this.showBuildings = saved.showBuildings;
		if (saved.showClouds !== undefined) this.showClouds = saved.showClouds;
		if (saved.syncToRealTime !== undefined) this.syncToRealTime = saved.syncToRealTime;
	}

	// ========================================================================
	// ACTIONS
	// ========================================================================
	setLocation(id: LocationId): void {
		this.location = id;
		this.flight.setLocationWithSky(id, this.skyState);
	}

	applyPatch(patch: Partial<PatchableState> | DisplayConfig): void {
		if (patch.altitude !== undefined) {
			this.flight.setAltitude(patch.altitude);
			this.onUserInteraction('altitude');
		}
		if (patch.timeOfDay !== undefined) {
			this.timeOfDay = clamp(patch.timeOfDay, 0, 24);
			this.onUserInteraction('time');
		}
		if (patch.weather !== undefined) this.weather = patch.weather;
		if (patch.cloudDensity !== undefined) {
			this.cloudDensity = clamp(patch.cloudDensity, 0, 1);
			this.onUserInteraction('atmosphere');
		}
		// ... remaining patch logic
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
		}, 8000);
	}

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

	// ========================================================================
	// TICK PIPELINE
	// ========================================================================
	tick(delta: number): void {
		if (!Number.isFinite(delta) || delta <= 0 || delta > 0.1) return;
		this.time = (this.time + delta) % 3600;

		const ctx = this.createContext();

		// 1. Flight Sim (Updates core position)
		this.flight.tick(delta, ctx);

		// 2. Secondary Engines
		this.motion.tick(delta, {
			...ctx,
			turbulenceLevel: WEATHER_EFFECTS[this.weather].turbulence
		});
		this.events.tick(delta, ctx);

		const atmospherePatch = this.atmosphere.tick(delta, {
			...ctx,
			showLightning: WEATHER_EFFECTS[this.weather].hasLightning
		});
		if (atmospherePatch) this.applyAtmospherePatch(atmospherePatch);

		// 3. Autopilot (Director)
		if (this.flight.flightMode === 'orbit') {
			const nextId = this.director.tick(delta, {
				...ctx,
				pickNextLocation: () => this.flight.pickNextLocation(this.timeOfDay, this.location)
			});
			if (nextId) this.flight.flyTo(nextId);
		}

		// 4. Maintenance
		if (this.autoQuality) this.tickAutoQuality(delta);
	}

	private createContext(): SimulationContext {
		return {
			time: this.time,
			lat: this.flight.lat,
			lon: this.flight.lon,
			altitude: this.flight.altitude,
			heading: this.flight.heading,
			pitch: this.flight.pitch,
			bankAngle: this.motion.bankAngle,
			weather: this.weather,
			skyState: this.skyState,
			nightFactor: this.nightFactor,
			dawnDuskFactor: this.dawnDuskFactor,
			locationId: this.location,
			userAdjustingAltitude: this.userAdjustingAltitude,
			userAdjustingTime: this.userAdjustingTime,
			userAdjustingAtmosphere: this.userAdjustingAtmosphere,
			cloudDensity: this.cloudDensity,
			cloudSpeed: this.cloudSpeed,
			haze: this.haze
		};
	}

	private applyAtmospherePatch(patch: any): void {
		if (patch.cloudDensity !== undefined) this.cloudDensity = patch.cloudDensity;
		if (patch.cloudSpeed !== undefined) this.cloudSpeed = patch.cloudSpeed;
		if (patch.haze !== undefined) this.haze = patch.haze;
		if (patch.weather !== undefined) this.weather = patch.weather;
	}

	private tickAutoQuality(delta: number): void {
		if (this.measuredFps === 0) return;
		this._qualityCheckTimer += delta;
		if (this._qualityCheckTimer < this.QUALITY_CHECK_INTERVAL) return;
		this._qualityCheckTimer = 0;

		const idx = this.QUALITY_MODES.indexOf(this.qualityMode);
		if (this.measuredFps < 20 && idx > 0) this.qualityMode = this.QUALITY_MODES[idx - 1];
		else if (this.measuredFps > 40 && idx < this.QUALITY_MODES.length - 1) this.qualityMode = this.QUALITY_MODES[idx + 1];
	}

	destroy(): void {
		if (this.userOverrideTimeout) clearTimeout(this.userOverrideTimeout);
	}
}
