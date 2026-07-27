/**
 * sprite factory — SpriteBundle → Effect<SpriteParams>.
 *
 * Sprite effect: Cesium Billboard at a geo-position.
 *   altitude omitted = clamped to terrain (ground-level signs, landmarks);
 *   altitude set = absolute meters above ellipsoid (passing planes, balloons).
 */

import type { Effect } from '../../types';
import type { SpriteBundle } from '../../bundle/types';
import { evalWhen } from '../../bundle/types';
import SpriteComponent from './effect.svelte';

export interface SpriteParams {
	image: string;
	lat: number;
	lon: number;
	altitude?: number;
	width?: number;
	height?: number;
}

export function createSpriteEffect(bundle: SpriteBundle): Effect<SpriteParams> {
	return {
		id: bundle.id,
		kind: bundle.kind,
		z: bundle.z,
		when: (model) => evalWhen(bundle.when, model),
		component: SpriteComponent,
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