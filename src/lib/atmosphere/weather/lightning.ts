import type { Effect } from '$lib/scene/types';
import Component from './Lightning.svelte';

const lightning: Effect = {
	id: 'lightning',
	kind: 'atmo',
	z: 2,
	when: (model) => model.config.atmosphere.weather.hasLightning,
	component: Component,
};

export default lightning;
