/**
 * Dawn over the Himalayas — Everest ridgeline first light.
 *
 * Boot-baseline show (no cues). Mountain archetype balances the city-
 * heavy rotation. Clear-sky dawn so the snow ridges catch the warm-amber
 * raking light — classic alpine cinema beat.
 */

import type { Show } from './types';

export const dawnHimalayasShow: Show = {
	id: 'dawn-himalayas',
	name: 'Himalayas First Light',
	description: 'Dawn over Everest ridgeline, clear sky, alpine cold light.',
	opening: {
		location: 'himalayas',
		weather: 'clear',
		timeOfDay: 7.0,
	},
};
