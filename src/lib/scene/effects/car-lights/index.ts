import type { Effect } from '../../types';
import { LOCATION_MAP } from '$lib/locations';
import Component from './effect.svelte';

const carLights: Effect = {
	id: 'car-lights',
	kind: 'geo',
	z: 0, // geo effects render inside Cesium canvas — z on compositor layer is a no-op for them
	// Only at night (nightFactor > 0.15 = ~18:30) AND over urban locations.
	// hasBuildings doubles as the "has cars" flag — cities have them, ocean/desert/himalayas don't.
	when: (model) => {
		if (model.nightFactor < 0.15) return false;
		const loc = LOCATION_MAP.get(model.location);
		return !!loc?.hasBuildings;
	},
	component: Component,
};

export default carLights;
