import type { Effect } from '$lib/scene/types';
import MicroEventsEffect from './MicroEventsEffect.svelte';

const microEvents: Effect = {
	id: 'micro-events',
	kind: 'atmo',
	z: 3,
	component: MicroEventsEffect,
};

export default microEvents;
