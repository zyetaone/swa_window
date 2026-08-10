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

import type { Show } from '$content/shows';
import type { LocationId, WeatherType } from '$lib/types';

// Re-export so existing callers (admin panel, etc.) keep their import
// surface without needing to know about the content/control split.
export type { Show };

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
