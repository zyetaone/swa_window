/**
 * Sunset over Dubai — a 30-second choreographed evening reveal.
 *
 * The first show to use the Move 1 timeline runner. Walks the camera
 * from Hyderabad clear-day into a Dubai dusk, then accelerates
 * time-of-day across the sunset window so passengers see the sun
 * tracking down past the Burj. Ends with a clear blue-hour Dubai
 * night looking toward the city's amber footprint.
 *
 * Curated to land in roughly 30 seconds — long enough for a passenger
 * walking the corridor to stop, short enough that the autopilot
 * resumes a fresh wander before they get bored.
 *
 * Cue cadence:
 *   t=0s     fly to dubai (orbit transition takes ~2s)
 *   t=3s     time-of-day jumps to 17.5 (early dusk over Dubai)
 *   t=12s    weather shifts to clear (clean sunset visibility)
 *   t=18s    time advances to 18.5 (peak dusk; sun on horizon)
 *   t=26s    time advances to 19.5 (post-sunset blue hour)
 *   t=30s    final hold — runner clears activeShowId, director resumes
 *
 * Director suspension (Move 2) is automatic via activeShowId.
 */

import type { Show } from '$lib/show/load';

export const sunsetDubaiShow: Show = {
	id: 'sunset-dubai',
	name: 'Sunset over Dubai',
	description:
		'30-second choreographed reveal: flies to Dubai, accelerates the sun ' +
		'through the dusk window past the Burj skyline, ends in blue-hour ' +
		'city light. First timeline-driven show — Move 1 demonstrator.',
	opening: {
		location: 'hyderabad',
		weather: 'clear',
		timeOfDay: 12,
	},
	cues: [
		{
			atMs: 0,
			label: 'Fly to Dubai',
			patches: [{ path: 'location', value: 'dubai' }],
		},
		{
			atMs: 3_000,
			label: 'Early dusk',
			patches: [{ path: 'timeOfDay', value: 17.5 }],
		},
		{
			atMs: 12_000,
			label: 'Clean skies',
			patches: [{ path: 'weather', value: 'clear' }],
		},
		{
			atMs: 18_000,
			label: 'Peak dusk — sun on horizon',
			patches: [{ path: 'timeOfDay', value: 18.5 }],
		},
		{
			atMs: 26_000,
			label: 'Blue hour',
			patches: [{ path: 'timeOfDay', value: 19.5 }],
		},
		{
			atMs: 30_000,
			label: 'Hold + release to director',
			// Empty patches set the show's "natural end" — runner clears
			// activeShowId after this cue and the director resumes from
			// Dubai blue hour. The director then wanders from there.
			patches: [],
		},
	],
};
