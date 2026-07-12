/**
 * Midday over Phoenix — the rotation's clear-sky NOON hero.
 *
 * The Jul-12 creative review found the 11-hour day window had no authored
 * beat at all (the only daytime show was monsoon-mumbai, deliberately
 * overcast) — midday was both mechanically hazed (fixed in 2b6eb6a) and
 * creatively unattended. This is the "what noon looks like at its best"
 * reference: an SWA hub, hard desert light, sharp terrain shadows, brand-
 * consistent with the dawn-Hyderabad default.
 */

import type { Show } from '$lib/show/load';

export const middayPhoenixShow: Show = {
	id: 'midday-phoenix',
	name: 'High Noon Phoenix',
	description:
		'Clear desert noon over an SWA hub — hard light, long sightlines, ' +
		'sharp relief. The daytime anchor of the rotation.',
	opening: {
		location: 'phoenix',
		weather: 'clear',
		timeOfDay: 12,
	},
};
