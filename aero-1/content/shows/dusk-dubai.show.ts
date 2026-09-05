/**
 * Dusk over Dubai — Palm Jumeirah golden hour.
 *
 * Boot-baseline show (no cues). Used by the daily show rotation
 * (`pickDailyShow` in `content/shows/index.ts`) so the kiosk opens with
 * a different scene each day.
 * is a timed cue sequence — this is just an opening state the director
 * inherits and wanders from.
 */

import type { Show } from './types';

export const duskDubaiShow: Show = {
	id: 'dusk-dubai',
	name: 'Dubai Golden Hour',
	description: 'Sunset over Palm Jumeirah, clear sky, late afternoon light.',
	opening: {
		location: 'dubai',
		weather: 'clear',
		timeOfDay: 17.5,
	},
};
