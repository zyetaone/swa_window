/**
 * Default show — the out-of-the-box experience before any admin pushes
 * or persisted state override.
 *
 * This file is the SSOT for "what plays at boot." AeroWindow's class-field
 * defaults are stubs immediately overwritten by applyShowOpening() in the
 * constructor — edit here to change the opening, not there.
 */

import type { Show } from '$lib/show/load';

export const defaultShow: Show = {
	id: 'default',
	name: 'Default',
	description:
		'Out-of-the-box opening: dawn over Hyderabad (06:30 local, clear sky). ' +
		'Council Q2 (2026-05-20) chose this single hand-tuned hero frame over a ' +
		'choreographed timed sequence — let the autopilot wander from a thoughtful ' +
		'opening rather than scripting beats. Per Q5 council and Experience Designer ' +
		'guidance, the moment is intended to be held long enough to land (15-20s) ' +
		'before the autopilot first decision lands.',
	opening: {
		location: 'hyderabad',
		weather: 'clear',
		timeOfDay: 6.5,
	},
};
