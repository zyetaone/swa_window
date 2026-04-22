import type { Effect } from '../../types';
import { LOCATION_MAP } from '$lib/locations';
import CarLightsEffect from './CarLightsEffect.svelte';

const carLights: Effect = {
	id: 'car-lights',
	kind: 'geo',
	z: 0,
	when: (model) => {
		if (model.nightFactor < 0.15) return false;
		const loc = LOCATION_MAP.get(model.location);
		return !!loc?.hasBuildings;
	},
	component: CarLightsEffect,
};

export default carLights;
