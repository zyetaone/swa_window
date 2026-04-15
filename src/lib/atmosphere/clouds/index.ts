import type { Effect } from '$lib/scene/types';
import Component from './effect.svelte';

const clouds: Effect = {
	id: 'clouds',
	kind: 'atmo',
	z: 1,
	when: (model) => model.showClouds,
	component: Component,
};

export default clouds;
