import type { Effect } from '$lib/scene/types';
import Component from './effect.svelte';

const microEvents: Effect = {
	id: 'micro-events',
	kind: 'atmo',
	z: 3,
	// Always mounted — the component decides when to actually spawn an event.
	component: Component,
};

export default microEvents;
