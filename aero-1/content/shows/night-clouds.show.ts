/**
 * Above the clouds at night — high-altitude cruise, stars dominate.
 *
 * Boot-baseline show (no cues). 45 kft over a cloud deck means no city
 * footprint, no terrain detail — the deep-night sky + Moon + Milky Way
 * (via NightStars deterministic seeded pattern) become the entire scene.
 * The most "you are flying" beat in the rotation.
 */

import type { Show } from './types';

export const nightCloudsShow: Show = {
	id: 'night-clouds',
	name: 'Above the Clouds',
	description: 'High-altitude night cruise, clear sky, stars dominant.',
	opening: {
		location: 'clouds',
		weather: 'clear',
		timeOfDay: 23.0,
	},
};
