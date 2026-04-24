/**
 * Show primitive — the authored artifact that drives what an installation plays.
 *
 * A Show is the unit of CURATED CONTENT. Today it's minimal (just an opening
 * state — location, weather, time-of-day). The intended growth surface:
 *   - scenes:   named (location, weather, time) tuples — a bank of "looks"
 *   - cues:     time-of-day or event-triggered transitions between scenes
 *   - rotation: weighted picker for autopilot's next scene choice
 *   - palette:  per-show overrides of the sky / car-light palette
 *
 * Type stays intentionally small until a second show exists. Grow the shape
 * when there's a concrete second use case pulling on it.
 */

import type { LocationId, WeatherType } from '$lib/types';

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
