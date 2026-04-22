import type { Effect } from '$lib/scene/types';
import { Z } from '$lib/scene/layers';
import CloudsEffect from './CloudsEffect.svelte';

const clouds: Effect = {
	id: 'clouds',
	kind: 'atmo',
	z: Z.clouds,
	when: (model) => model.config.world.showClouds,
	component: CloudsEffect,
};

export default clouds;
