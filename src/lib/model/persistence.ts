/**
 * AeroWindow persistence — localStorage save/load for the user's last
 * session state. Pure data only — no runes, no class context, no DOM
 * reactivity. Wire-up: AeroWindow ctor loads on boot; +page.svelte saves
 * via a 2s-debounced $effect auto-save on snapshot change (there is no
 * unload handler) — so a change made <2s before a power-cut is lost.
 *
 * Display mode (video/slideshow) lives in a separate key —
 * `$lib/fleet/display-mode-persist` — so media survives reload without
 * participating in the daily location/weather rotation gate.
 */
import { isValidWeather, type LocationId, type WeatherType } from '$lib/types';
import { isValidLocation } from '$content/locations';
import { daySeed } from '$lib/world/prng';

// Altitude bounds for persisted state validation — mirrors CameraConfig.altitude.
// Hardcoded here (one-time startup concern) to keep persistence.ts free of
// app-state dependencies.
const ALT_MIN = 10_000;
const ALT_DEFAULT = 35_000;
const ALT_MAX = 65_000;

export const STORAGE_KEY = 'aero-window-v2';

export interface PersistedState {
	location: LocationId;
	altitude: number;
	weather: WeatherType;
	cloudDensity: number;
	buildingsEnabled: boolean;
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
			parsed.altitude = safeNum(parsed.altitude, ALT_DEFAULT, ALT_MIN, ALT_MAX);
		}
		if (parsed.cloudDensity !== undefined) {
			parsed.cloudDensity = safeNum(parsed.cloudDensity, 0.85, 0, 1);
		}
		if (parsed.location !== undefined && !isValidLocation(parsed.location)) {
			delete parsed.location;
		}
		if (parsed.weather !== undefined) {
			if (!isValidWeather(parsed.weather)) {
				delete parsed.weather;
			}
		}

		// Daily-rotation gate — if the persisted dayKey doesn't match today's
		// daySeed, strip `location` and `weather` so the boot path falls back
		// to today's `pickDailyShow()` opening. Without this, persistence
		// pinned the kiosk to the user's last manual override forever; the
		// daily rotation was invisible on a deployed kiosk after first boot.
		// Other fields (altitude, cloudDensity, building/cloud toggles,
		// syncToRealTime) carry forward unchanged across days — they reflect
		// operator preferences, not scene state.
		const today = daySeed();
		if (typeof parsed.dayKey !== 'number' || parsed.dayKey !== today) {
			delete parsed.location;
			delete parsed.weather;
		}
		delete parsed.dayKey; // never expose internal field to PersistedState consumers

		// Validate boolean flags
		if (parsed.buildingsEnabled !== undefined && typeof parsed.buildingsEnabled !== 'boolean') {
			delete parsed.buildingsEnabled;
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
		// Stamp the current dayKey so loadPersistedState() can detect a
		// day rollover and let the daily show rotation pick win on the
		// next boot. See loadPersistedState() for the gate logic.
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, dayKey: daySeed() }));
	} catch {
		// Storage full or blocked — silently ignore
	}
}
