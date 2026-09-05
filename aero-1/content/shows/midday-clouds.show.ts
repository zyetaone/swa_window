/**
 * Above the deck at midday — blue sky over, cloud floor under.
 *
 * ⚠ NOT IN DAILY_ROTATION — operator/URL only. It was added to the rotation
 * and shipped that way for a few hours on 2026-08-23, on the assumption that
 * the `timeOfDay` below keeps it daylit. It does not: syncToRealTime defaults
 * true and persistence refuses to restore it, so the fleet replaces this hour
 * with the real civil hour at the destination. `clouds` is Asia/Tokyo, and 4
 * of the 12 two-hour UTC slots put it in deep night — the same void that
 * keeps night-clouds out. The hour below governs only when a human pins it.
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
		'below. Operator-selected: the rotation cannot guarantee the hour.',
	opening: {
		location: 'clouds',
		weather: 'cloudy',
		timeOfDay: 13.0,
	},
};
