import type { Effect } from '$lib/scene/types';
import { WEATHER_EFFECTS } from '$lib/constants';
import Component from './Lightning.svelte';

const lightning: Effect = {
	id: 'lightning',
	kind: 'atmo',
	z: 2,
	// Only mount when weather has lightning — component handles its own strike
	// timing from within, but unmounting when inactive frees the subscription.
	when: (model) => WEATHER_EFFECTS[model.weather].hasLightning,
	component: Component,
};

export default lightning;
