/**
 * Default show — the out-of-the-box experience before any admin pushes
 * or persisted state override. Matches the historical hard-coded initial
 * state (Dubai, cloudy, noon).
 *
 * To change the opening state shipped to every fresh device, edit this
 * file. No code change needed elsewhere.
 */

import type { Show } from '$lib/show/load';

export const defaultShow: Show = {
	id: 'default',
	name: 'Default',
	description: 'Out-of-the-box opening: Dubai at local noon, cloudy.',
	opening: {
		location: 'dubai',
		weather: 'cloudy',
		timeOfDay: 12,
	},
};
