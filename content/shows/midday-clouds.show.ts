/**
 * Above the deck at midday — blue sky over, cloud floor under.
 *
 * The `clouds` location (45 kft, CLOUDS_SCENE) already existed but had
 * exactly one show, night-clouds, which is deliberately OUT of the rotation:
 * hasBuildings:false plus deep night is a black void with nothing to light.
 * So the catalogue's one genuinely "you are at altitude" location never
 * actually plays. This is its daytime beat, and the reason it works is the
 * same reason the night one doesn't — at 45 kft there is no ground to carry
 * the frame, so the frame has to be the sky itself.
 *
 * Why `cloudy` and not `overcast`: overcast reads as the heavier sky on
 * paper, but its recipe carries rainOpacity 0.18 and filterBrightness 0.9 —
 * it dims the whole scene and puts rain on the glass, which is the view from
 * INSIDE weather. This show is above it. `cloudy` is density 0.7–1 with no
 * rain and brightness 1.0: a thick deck with the sky over it left alone.
 *
 * 13:00 rather than 12:00 — noon is already Phoenix's beat, and an hour past
 * noon puts enough angle in the light to model the deck's tops instead of
 * flattening them. Nothing else needs setting: the deck sits at CLOUD_ALT_M
 * (7 km / ~23 kft) and the location cruises at 45 kft, so "below" is
 * geometry, not a parameter.
 */

import type { Show } from './types';

export const middayCloudsShow: Show = {
	id: 'midday-clouds',
	name: 'Over the Deck',
	description:
		'Midday at 45,000 feet — open blue above, an unbroken cloud floor ' +
		'below. The altitude beat the rotation only had a night version of.',
	opening: {
		location: 'clouds',
		weather: 'cloudy',
		timeOfDay: 13.0,
	},
};
