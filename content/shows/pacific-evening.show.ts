/**
 * Pacific sunset — Hawaiian islands, evening over open ocean.
 *
 * Boot-baseline show (no cues). Adds water-archetype variety. Open ocean
 * at dusk with the sun glinting off swell is one of the iconic "I'm on
 * an airplane" scenes a real window-seat passenger would remember.
 */

import type { Show } from '$lib/show/load';

export const pacificEveningShow: Show = {
	id: 'pacific-evening',
	name: 'Pacific Sunset',
	description: 'Evening over Hawaiian Islands, clear sky, ocean horizon.',
	opening: {
		location: 'ocean',
		weather: 'clear',
		timeOfDay: 19.0,
	},
};
