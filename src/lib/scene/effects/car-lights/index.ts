import type { Effect } from '../../types';
import { Z } from '../../layers';
import { LOCATION_MAP } from '$content/locations';
import { CAR_LIGHTS_MOUNT_LO, CAR_LIGHTS_MOUNT_HI } from '$lib/utils';
import CarLightsEffect from './CarLightsEffect.svelte';

// Closure-scoped hysteresis state. The compositor calls `when` every
// derived tick; without sticky state, nightFactor jitter across a
// single threshold tears down + rebuilds the 350-entity datasource
// repeatedly at dusk. With hysteresis: mount on HI cross, unmount on
// LO cross, hold otherwise.
let _carLightsMounted = false;

const carLights: Effect = {
	id: 'car-lights',
	kind: 'earth',
	z: Z.geo,
	when: (model) => {
		// Self-disable when the Three overlay is on (hybrid-v2): world/three/OsmRoads
		// neon owns the street dots, so the Cesium entities would double them.
		if (model.config.world.useThreeOverlay) {
			_carLightsMounted = false;
			return false;
		}
		const loc = LOCATION_MAP.get(model.location);
		if (!loc?.hasBuildings) {
			_carLightsMounted = false;
			return false;
		}
		const nf = model.nightFactor;
		if (_carLightsMounted) {
			if (nf < CAR_LIGHTS_MOUNT_LO) _carLightsMounted = false;
		} else {
			if (nf > CAR_LIGHTS_MOUNT_HI) _carLightsMounted = true;
		}
		return _carLightsMounted;
	},
	component: CarLightsEffect,
};

export { carLights };