import type { Effect } from '$lib/scene/types';
import { Z } from '$lib/scene/layers';
import Clouds from './ArtsyClouds.svelte';

const clouds: Effect = {
	id: 'clouds',
	kind: 'atmo',
	z: Z.clouds,
	when: (model) => model.config.world.showClouds,
	component: Clouds,
};

export default clouds;
