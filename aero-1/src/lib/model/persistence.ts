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
import type { LocationId, WeatherType } from '$lib/types';
import {
	AMBIENT_PERSIST_PATHS,
	validateAmbientValue,
	type AmbientValue,
	type PeerSyncPath,
} from '$lib/model/peer-sync-paths';

// Altitude bounds for persisted state validation — mirrors CameraConfig.altitude.
// Hardcoded here (one-time startup concern) to keep persistence.ts free of
// app-state dependencies.
const ALT_MIN = 10_000;
const ALT_DEFAULT = 35_000;
const ALT_MAX = 65_000;

export const STORAGE_KEY = 'aero-window-v2';

export interface PersistedState {
	/**
	 * Scene location/weather are intentionally NOT restored on boot — boot
	 * always opens from `pickDailyShow(showRotationSeed())` so the wall
	 * rotates. Fields may still appear in legacy blobs; load strips them.
	 */
	location?: LocationId;
	altitude: number;
	weather?: WeatherType;
	cloudDensity: number;
	buildingsEnabled: boolean;
	showClouds: boolean;
	/**
	 * ─── LEGACY. READ FOR VALIDATION, NEVER RESTORED, NEVER WRITTEN ──────────
	 * Real Time now always comes back ON at boot.
	 *
	 * Turning it off freezes the sky at whatever hour it held. That is a useful
	 * thing to do for a demo and a terrible thing to persist: an unattended wall
	 * that reboots nightly would show the same frozen afternoon forever, and
	 * because the stored value is applied AFTER the code default, no change to
	 * the default could ever recover it. The failure is silent — a frozen sky
	 * looks like a working sky until someone notices it has not moved all week.
	 *
	 * Same reasoning as location and weather, which have never been restored:
	 * boot must land in a known-good state, not in whoever-touched-it-last.
	 * Operators can still toggle it at runtime; it just does not outlive the
	 * session. Kept in the type so legacy blobs still validate rather than
	 * being rejected wholesale.
	 */
	syncToRealTime?: boolean;
	/**
	 * Ambient peer-sync config values keyed by config path — every
	 * PEER_SYNC_PATHS entry (`$lib/model/peer-sync-paths`) except the three
	 * covered by the named fields above. Operator-preference class: carries
	 * forward across reboots. Without this a rebooted Pi silently reverted
	 * admin-pushed ambient values (haze, nightLightIntensity, qualityMode, …)
	 * to code defaults.
	 */
	ambient: Partial<Record<PeerSyncPath, AmbientValue>>;
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

		// Scene / mode state is never restored: boot always uses pickDailyShow /
		// showRotationSeed and known-good defaults. Legacy blobs may still carry
		// location/weather/dayKey/syncToRealTime.
		delete parsed.location;
		delete parsed.weather;
		delete parsed.dayKey;
		// Real Time always boots ON (demo-frozen sky must not outlive the session).
		delete parsed.syncToRealTime;

		// Validate boolean flags
		if (parsed.buildingsEnabled !== undefined && typeof parsed.buildingsEnabled !== 'boolean') {
			delete parsed.buildingsEnabled;
		}
		if (parsed.showClouds !== undefined && typeof parsed.showClouds !== 'boolean') {
			delete parsed.showClouds;
		}

		// Ambient peer-sync values — validated per path against
		// AMBIENT_PATH_SPECS (booleans/enums dropped when wrong-typed, numbers
		// clamped to panel range). NOT gated by dayKey: these are operator
		// preferences like altitude, not scene state.
		if (parsed.ambient !== undefined) {
			if (!parsed.ambient || typeof parsed.ambient !== 'object' || Array.isArray(parsed.ambient)) {
				delete parsed.ambient;
			} else {
				const clean: Partial<Record<PeerSyncPath, AmbientValue>> = {};
				for (const [path, raw] of Object.entries(parsed.ambient)) {
					if (!(AMBIENT_PERSIST_PATHS as readonly string[]).includes(path)) continue;
					const value = validateAmbientValue(path as PeerSyncPath, raw);
					if (value !== undefined) clean[path as PeerSyncPath] = value;
				}
				if (Object.keys(clean).length > 0) parsed.ambient = clean;
				else delete parsed.ambient;
			}
		}

		return parsed;
	} catch {
		return {};
	}
}

/**
 * Has this device EVER persisted state? Distinct from "did load return
 * anything", which is the question callers used to ask by testing
 * `Object.keys(loadPersistedState()).length === 0`.
 *
 * Those two diverged once load began stripping fields: a blob whose every key
 * is stripped (a dev box that had only ever stored `syncToRealTime`) loads as
 * `{}` and became indistinguishable from a browser that had never run the app.
 * The DEV deep-night default keys off "fresh environment", so it started firing
 * for people who had state — silently forcing Real Time off in dev and
 * contradicting the boot rule it sits next to.
 */
export function hasPersistedState(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		return localStorage.getItem(STORAGE_KEY) !== null;
	} catch {
		return false;
	}
}

export function savePersistedState(state: PersistedState): void {
	if (typeof window === 'undefined') return;
	try {
		// Never write location/weather — boot must open from the rotation seed.
		// Never write syncToRealTime — boot must open with Real Time ON, so a
		// demo-frozen sky cannot outlive the session that froze it.
		const { location: _l, weather: _w, syncToRealTime: _s, ...rest } = state;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
	} catch {
		// Storage full or blocked — silently ignore
	}
}
