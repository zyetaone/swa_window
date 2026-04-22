import type { Effect } from '$lib/scene/types';
import CloudsEffect from './CloudsEffect.svelte';

const clouds: Effect = {
	id: 'clouds',
	kind: 'atmo',
	z: 1,
	when: (model) => model.showClouds,
	component: CloudsEffect,
};

export default clouds;
