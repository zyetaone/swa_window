/**
 * Dusk over Dallas — DFW metro golden hour.
 */
import type { Show } from './types';

export const duskDallasShow: Show = {
	id: 'dusk-dallas',
	name: 'Dallas Golden Hour',
	description: 'Late-day light over the DFW skyline, clear sky.',
	opening: {
		location: 'dallas',
		weather: 'clear',
		timeOfDay: 18.0,
	},
};
