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
	description: 'Out-of-the-box opening: Hyderabad at local noon, cloudy (SWA inauguration default).',
	opening: {
		location: 'hyderabad',
		weather: 'cloudy',
		timeOfDay: 12,
	},
};
