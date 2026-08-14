/**
 * Night over Chicago Midway — city lights.
 */
import type { Show } from './types';

export const nightChicagoShow: Show = {
	id: 'night-chicago',
	name: 'Chicago Night',
	description: 'Deep night over the Midway corridor, clear sky for VIIRS punch.',
	opening: {
		location: 'chicago_midway',
		weather: 'clear',
		timeOfDay: 22.0,
	},
};
