import type { LocationId, WeatherType } from './types';
import { LOCATION_IDS } from './locations';
import { AIRCRAFT } from './constants';

const STORAGE_KEY = 'aero-window-v2';

export interface PersistedState {
	location: LocationId;
	altitude: number;
	weather: WeatherType;
	cloudDensity: number;
	showBuildings: boolean;
	showClouds: boolean;
	syncToRealTime: boolean;
}

export function safeNum(value: unknown, fallback: number, min?: number, max?: number): number {
	if (value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	let v = value;
	if (min !== undefined && v < min) v = min;
	if (max !== undefined && v > max) v = max;
	return v;
}

export function loadPersistedState(): Partial<PersistedState> {
	if (typeof window === 'undefined') return {};
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (!saved) return {};
		const parsed = JSON.parse(saved);
		if (parsed.altitude !== undefined) {
			parsed.altitude = safeNum(parsed.altitude, 35000, AIRCRAFT.MIN_ALTITUDE, AIRCRAFT.MAX_ALTITUDE);
		}
		if (parsed.cloudDensity !== undefined) {
			parsed.cloudDensity = safeNum(parsed.cloudDensity, 0.7, 0, 1);
		}
		if (parsed.location && !LOCATION_IDS.has(parsed.location)) {
			delete parsed.location;
		}
		const VALID_WEATHER: WeatherType[] = ['clear', 'cloudy', 'rain', 'overcast', 'storm'];
		if (parsed.weather && !VALID_WEATHER.includes(parsed.weather)) {
			delete parsed.weather;
		}
		return parsed;
	} catch {
		return {};
	}
}

export function savePersistedState(state: PersistedState): void {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Storage full or blocked — silently ignore
	}
}
