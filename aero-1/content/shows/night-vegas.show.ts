/**
 * Las Vegas night — neon strip, full city lights.
 *
 * Boot-baseline show (no cues). High-impact urban-night vibe — bright
 * VIIRS footprint + warm sodium glow on cloud undersides. Good contrast
 * with the dawn / day shows in the rotation.
 */

import type { Show } from './types';

export const nightVegasShow: Show = {
	id: 'night-vegas',
	name: 'Vegas Strip Night',
	description: 'Las Vegas after dark, clear sky, dense city light footprint.',
	opening: {
		location: 'las_vegas',
		weather: 'clear',
		timeOfDay: 22.0,
	},
};
