/**
 * Factory: SpriteBundle → Effect<SpriteParams>
 * Called by the bundle loader when a bundle of type 'sprite' is registered.
 */

import type { Effect } from '../../types';
import type { SpriteBundle } from '../../bundle/types';
import type { SpriteParams } from './types';
import { evalWhen } from '../../bundle/when';
import Component from './effect.svelte';

export function createSpriteEffect(bundle: SpriteBundle): Effect<SpriteParams> {
	return {
		id: bundle.id,
		kind: bundle.kind,
		z: bundle.z,
		when: (model) => evalWhen(bundle.when, model),
		component: Component,
		params: {
			image: bundle.image,
			lat: bundle.lat,
			lon: bundle.lon,
			altitude: bundle.altitude,
			width: bundle.width,
			height: bundle.height,
		},
	};
}
