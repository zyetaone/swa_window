/**
 * Show — the authored artifact that drives what an installation plays.
 *
 * A show is a boot-baseline: an `opening` tuple "played" once at boot to
 * set the device's starting state; the director runs freely after that.
 * (A timed-cue "timeline" flavour existed — runner.svelte.ts + Cue types —
 * but never gained a live trigger and was deleted in the Jul-13 council;
 * revive from git history at that commit if authored choreography returns.)
 *
 * The Show interface is the content/control boundary: content/shows/*.show.ts
 * files conform to it; the control plane reads it but does not redefine it.
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
