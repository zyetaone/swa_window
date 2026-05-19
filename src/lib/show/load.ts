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
 * A Show is the unit of CURATED CONTENT. Today it's minimal (just an
 * opening state). The intended growth surface:
 *   - scenes:   named (location, weather, time) tuples — a bank of "looks"
 *   - cues:     time-of-day or event-triggered transitions between scenes
 *   - rotation: weighted picker for autopilot's next scene choice
 *   - palette:  per-show overrides of the sky / car-light palette
 *
 * Shape stays intentionally small until a second show exists. Grow when
 * there's a concrete second use case pulling on it.
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
