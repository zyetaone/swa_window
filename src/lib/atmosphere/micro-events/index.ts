import type { Effect } from '$lib/scene/types';
import { Z } from '$lib/scene/layers';
import MicroEventsEffect from './MicroEventsEffect.svelte';

const microEvents: Effect = {
	id: 'micro-events',
	kind: 'atmo',
	z: Z.microEvents,
	component: MicroEventsEffect,
};

export default microEvents;
