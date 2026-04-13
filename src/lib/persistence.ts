import type { LocationId, WeatherType } from '$lib/types';
import { LOCATION_IDS } from '$lib/locations';
import { AIRCRAFT } from '$lib/constants';
import { isValidWeather } from '$lib/validation';

export const STORAGE_KEY = 'aero-window-v2';

export interface PersistedState {
	location: LocationId;
	altitude: number;
	weather: WeatherType;
	cloudDensity: number;
	showBuildings: boolean;
	showClouds: boolean;
	syncToRealTime: boolean;
}

function safeNum(value: unknown, fallback: number, min?: number, max?: number): number {
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

		// 🔒 Security: Ensure parsed value is a plain object
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {};
		}

		if (parsed.altitude !== undefined) {
			parsed.altitude = safeNum(parsed.altitude, AIRCRAFT.DEFAULT_ALTITUDE, AIRCRAFT.MIN_ALTITUDE, AIRCRAFT.MAX_ALTITUDE);
		}
		if (parsed.cloudDensity !== undefined) {
			parsed.cloudDensity = safeNum(parsed.cloudDensity, 0.7, 0, 1);
		}
		if (parsed.location !== undefined) {
			if (typeof parsed.location !== 'string' || !LOCATION_IDS.has(parsed.location)) {
				delete parsed.location;
			}
		}
		if (parsed.weather !== undefined) {
			if (!isValidWeather(parsed.weather)) {
				delete parsed.weather;
			}
		}

		// Validate boolean flags
		if (parsed.showBuildings !== undefined && typeof parsed.showBuildings !== 'boolean') {
			delete parsed.showBuildings;
		}
		if (parsed.showClouds !== undefined && typeof parsed.showClouds !== 'boolean') {
			delete parsed.showClouds;
		}
		if (parsed.syncToRealTime !== undefined && typeof parsed.syncToRealTime !== 'boolean') {
			delete parsed.syncToRealTime;
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
