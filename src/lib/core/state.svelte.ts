/**
 * Core State - Simplified Viewer State
 *
 * Manages: camera position, time, location, toggles
 * Uses Svelte 5 runes for reactivity
 */

export type { SkyState, SunPosition, ViewType, GeoCoordinate } from './types';

import { type SkyState, type SunPosition, type ViewType } from './types';
import { EnvironmentSystem, type BiomeColors } from './EnvironmentSystem';
import { getContext, setContext } from 'svelte';

// ViewPreset type (will be moved to $lib/presets/types when that module is created)
export interface ViewPreset {
	id: string;
	name: string;
	location: LocationId;
	timeOfDay: number;
	altitude: number;
	heading: number;
	pitch: number;
	cloudDensity?: number;
	visibility?: number;
	haze?: number;
	weather?: 'clear' | 'cloudy' | 'overcast' | 'storm';
	showBuildings?: boolean;
	showClouds?: boolean;
}

// Location presets
export type LocationId = 'dubai' | 'himalayas' | 'mumbai' | 'ocean' | 'desert' | 'clouds' | 'hyderabad' | 'dallas' | 'phoenix' | 'las_vegas';

export interface LocationPreset {
	id: LocationId;
	name: string;
	lat: number;
	lon: number;
}

export const LOCATIONS: LocationPreset[] = [
	{ id: 'dubai', name: 'Dubai', lat: 25.2048, lon: 55.2708 },
	{ id: 'mumbai', name: 'Mumbai', lat: 19.076, lon: 72.8777 },
	{ id: 'hyderabad', name: 'Hyderabad', lat: 17.4435, lon: 78.3772 },
	{ id: 'dallas', name: 'Dallas', lat: 32.7767, lon: -96.7970 },
	{ id: 'phoenix', name: 'Phoenix', lat: 33.4352, lon: -112.0101 },
	{ id: 'las_vegas', name: 'Las Vegas', lat: 36.1147, lon: -115.1728 },
	{ id: 'himalayas', name: 'Himalayas', lat: 27.9881, lon: 86.925 },
	{ id: 'ocean', name: 'Ocean', lat: 0, lon: -30 },
	{ id: 'desert', name: 'Sahara', lat: 23.4241, lon: 25.6628 },
	{ id: 'clouds', name: 'Above Clouds', lat: 45, lon: -100 },
];

const getCurrentTimeOfDay = () => {
	if (typeof window === 'undefined') return 12;
	const now = new Date();
	return now.getHours() + now.getMinutes() / 60;
};

export class ViewerState {
	// Camera / Position
	lat = $state(25.2048);
	lon = $state(55.2708);
	altitude = $state(35000); // feet - cruise altitude (10k-50k range)
	heading = $state(45); // degrees - angled view is more interesting
	pitch = $state(75); // camera pitch angle (70-80° looks good from side window)

	// Time of day (0-24)
	timeOfDay = $state(getCurrentTimeOfDay());

	// Current location
	location = $state<LocationId>('dubai');

	// Toggles
	showBuildings = $state(true);
	showClouds = $state(true);
	blindOpen = $state(true);

	// Weather/Atmospheric properties
	cloudDensity = $state(0.6); // 0-1 (higher default for more visible clouds)
	visibility = $state(35); // km (reduced for more atmospheric haze)
	haze = $state(0.25); // 0-1 (more haze for depth)
	weather = $state<'clear' | 'cloudy' | 'overcast' | 'storm'>('cloudy'); // Default to cloudy

	// Real-time sync
	syncToRealTime = $state(false);

	// Environment system for sky/lighting calculations
	private _environment = new EnvironmentSystem(this.timeOfDay);

	// Derived properties
	skyState = $derived<SkyState>(this._environment.skyState);
	sunPosition = $derived<SunPosition>(this._environment.sunPosition);
	biomeColors = $derived<BiomeColors>(this._environment.biomeColors);

	// Map zoom based on altitude
	mapZoom = $derived(Math.max(10, Math.min(18, 18 - Math.log2(this.altitude / 500))));

	constructor() {
		// Sync environment when time changes
		$effect(() => {
			this._environment.timeOfDay = this.timeOfDay;
		});

		// Sync environment when location changes
		$effect(() => {
			this._environment.setView(this.location);
		});

		// Real-time sync effect - updates timeOfDay to current real time every minute
		$effect(() => {
			if (this.syncToRealTime) {
				const updateRealTime = () => {
					this.timeOfDay = getCurrentTimeOfDay();
				};

				// Update immediately
				updateRealTime();

				// Then update every minute
				const interval = setInterval(updateRealTime, 60000);

				return () => clearInterval(interval);
			}
		});
	}

	// Actions
	setLocation(locationId: LocationId) {
		const loc = LOCATIONS.find(l => l.id === locationId);
		if (!loc) {
			console.warn(`Unknown location: ${locationId}`);
			return;
		}
		this.location = locationId;
		this.lat = loc.lat;
		this.lon = loc.lon;
	}

	setTime(time: number) {
		this.timeOfDay = Math.max(0, Math.min(24, time));
	}

	setAltitude(alt: number) {
		this.altitude = Math.max(500, Math.min(45000, alt));
	}

	setHeading(heading: number) {
		this.heading = ((heading % 360) + 360) % 360;
	}

	toggleBlind() {
		this.blindOpen = !this.blindOpen;
	}

	toggleBuildings() {
		this.showBuildings = !this.showBuildings;
	}

	toggleClouds() {
		this.showClouds = !this.showClouds;
	}

	// Preset management
	applyPreset(preset: ViewPreset) {
		// Set location first (updates lat/lon)
		this.setLocation(preset.location);

		// Apply all preset values
		this.timeOfDay = preset.timeOfDay;
		this.altitude = preset.altitude;
		this.heading = preset.heading;
		this.pitch = preset.pitch;

		// Apply optional weather/atmospheric properties
		if (preset.cloudDensity !== undefined) this.cloudDensity = preset.cloudDensity;
		if (preset.visibility !== undefined) this.visibility = preset.visibility;
		if (preset.haze !== undefined) this.haze = preset.haze;
		if (preset.weather !== undefined) this.weather = preset.weather;

		// Apply optional toggles
		if (preset.showBuildings !== undefined) this.showBuildings = preset.showBuildings;
		if (preset.showClouds !== undefined) this.showClouds = preset.showClouds;
	}

	toPreset(): Partial<ViewPreset> {
		return {
			location: this.location,
			timeOfDay: this.timeOfDay,
			altitude: this.altitude,
			heading: this.heading,
			pitch: this.pitch,
			cloudDensity: this.cloudDensity,
			visibility: this.visibility,
			haze: this.haze,
			weather: this.weather,
			showBuildings: this.showBuildings,
			showClouds: this.showClouds,
		};
	}
}

// Singleton Management
const STATE_KEY = Symbol('VIEWER_STATE');
let globalInstance: ViewerState;

export function createViewerState() {
	const state = new ViewerState();
	setContext(STATE_KEY, state);
	globalInstance = state;
	return state;
}

export function getViewerState(): ViewerState {
	try {
		return getContext<ViewerState>(STATE_KEY) || globalInstance || createViewerState();
	} catch {
		if (!globalInstance) globalInstance = new ViewerState();
		return globalInstance;
	}
}
