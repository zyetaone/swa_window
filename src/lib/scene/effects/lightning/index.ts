import type { Effect } from '$lib/scene/types';
import { Z } from '$lib/scene/layers';
import Component from './Lightning.svelte';

const lightning: Effect = {
	id: 'lightning',
	kind: 'sky',
	z: Z.lightning,
	when: (model) => model.config.atmosphere.weather.hasLightning,
	component: Component,
};

export { lightning };