/**
 * Monsoon afternoon over Mumbai — rain + cloud-cover, mid-afternoon.
 *
 * Boot-baseline show (no cues). Adds rain weather variety to the rotation;
 * the rain layer + spatter + dimmer ambient should land as a distinctly
 * different mood from the clear-sky shows.
 */

import type { Show } from '$lib/show/load';

export const monsoonMumbaiShow: Show = {
	id: 'monsoon-mumbai',
	name: 'Mumbai Monsoon',
	description: 'Rainy afternoon over Mumbai Harbor, heavy cloud cover.',
	opening: {
		location: 'mumbai',
		weather: 'rain',
		timeOfDay: 14.5,
	},
};
