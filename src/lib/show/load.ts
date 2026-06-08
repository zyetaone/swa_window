/**
 * Show loader — applies an authored Show's opening state to the running model.
 *
 * Called once during AeroWindow construction, BEFORE persisted state is
 * restored. Order of precedence at boot:
 *   1. Show opening (default baseline — this file applies it)
 *   2. Persisted state from localStorage (user's last session wins)
 *   3. Real-time sync (if syncToRealTime, timeOfDay is overwritten each tick)
 *   4. URL params (?location=X&altitude=Y overrides after the above)
 *   5. Admin pushes (live)
 *
 * applyShowOpening writes directly into model fields — it's the baseline
 * default, not a user interaction, so it does NOT fire onUserInteraction.
 */

import type { LocationId, WeatherType } from '$lib/types';

/**
 * Show — the authored artifact that drives what an installation plays.
 *
 * Two flavours:
 *   - **Boot-baseline:** just an `opening` tuple. The show "plays" once
 *     at boot to set the device's starting state. The director runs
 *     freely after that. This is what `default.show.ts` is.
 *   - **Timeline:** an `opening` PLUS an ordered list of `cues`. The
 *     show runner walks cues in time order, applying each as a batch
 *     of config patches at its offset from start. While the runner is
 *     active, `model.activeShowId` is set; the director suspends
 *     (Move 2 guard in autopilot.svelte.ts). When the last cue fires,
 *     the runner clears activeShowId and the director resumes.
 *
 * Cue patches reuse the v2 fleet wire 1:1 — each `{path, value}` is the
 * same shape `applyConfigPatch` already takes, so the same authored
 * timeline runs identically on a solo device or fans out across a 3-Pi
 * panorama via fleet broadcasts (deferred until install #2 — for the
 * SWA install the leader runs the show locally).
 */
export interface Show {
	/** Stable identifier — matches the filename (minus `.show.ts`). */
	id: string;
	/** Human-readable name shown in admin UI. */
	name: string;
	/** Short curator description of the show's vibe. */
	description?: string;
	/** Opening state — applied at device boot before persistence restore. */
	opening: {
		location: LocationId;
		weather: WeatherType;
		/** Decimal 0-24 in LOCAL solar time at the opening location. */
		timeOfDay: number;
	};
	/** Optional ordered cues. Shows without cues are boot-baseline only. */
	cues?: Cue[];
}

/**
 * A single authored cue — a batch of config patches that fire together
 * at `atMs` from show start. Use cues to choreograph timed transitions:
 *   - "fly to dubai at t=2000"
 *   - "set sun to dusk at t=8000"
 *   - "weather=storm at t=15000"
 *
 * `patches` reuses the v2 wire format. Anything `applyConfigPatch` can
 * write, a cue can write. For high-level transitions (location,
 * weather) prefer the setters via `path:'location'` / `path:'weather'`
 * style — `runner.svelte.ts` routes those to the right setters.
 *
 * A cue with `patches: []` (empty) is a valid "hold marker" — fires at
 * its atMs but applies nothing. Use as the final cue of a show to give
 * the prior cue's state breathing room before the runner releases
 * back to the director.
 */
export interface Cue {
	/** Offset in milliseconds from `startShow(model, show, startAtMs)`. */
	atMs: number;
	/** Batch of {path, value} patches applied together at atMs. Empty
	 *  array is valid — see "hold marker" pattern in the type docs. */
	patches: Array<{ path: string; value: unknown }>;
	/** Optional curator note (debug + admin UI; ignored by runner). */
	label?: string;
}

/** Narrow interface — only the fields applyShowOpening actually touches. */
interface ShowApplyTarget {
	location: LocationId;
	weather: WeatherType;
	timeOfDay: number;
}

/**
 * Apply a show's opening state. Mutates target in place.
 *
 * No side-effect hooks (interaction tracking, weather-config sync) — those
 * fire on USER action, not on baseline init. The caller is responsible for
 * running any post-load syncs (AeroWindow.#syncWeatherConfig) if needed.
 */
export function applyShowOpening(target: ShowApplyTarget, show: Show): void {
	target.location = show.opening.location;
	target.weather = show.opening.weather;
	target.timeOfDay = show.opening.timeOfDay;
}
