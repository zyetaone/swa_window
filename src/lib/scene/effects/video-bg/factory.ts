/**
 * Factory: VideoBgBundle → Effect<VideoBgParams>
 * Called by the bundle loader when a bundle of type 'video-bg' is registered.
 */

import type { Effect } from '../../types';
import type { VideoBgBundle } from '../../bundle/types';
import type { VideoBgParams } from './types';
import { evalWhen } from '../../bundle/when';
import Component from './effect.svelte';

export function createVideoBgEffect(bundle: VideoBgBundle): Effect<VideoBgParams> {
	return {
		id: bundle.id,
		kind: bundle.kind,
		z: bundle.z,
		when: (model) => evalWhen(bundle.when, model),
		component: Component,
		params: {
			asset: bundle.asset,
			fit: bundle.fit,
			opacity: bundle.opacity,
			blend: bundle.blend,
		},
	};
}
