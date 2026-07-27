/**
 * Effect factories — sprite + video-bg bundle creators.
 * Called by the bundle loader to produce Effect objects for compositor mounting.
 */

import type { Effect } from '../types';
import type { SpriteBundle, VideoBgBundle } from '../bundle/types';
import { evalWhen } from '../bundle/types';
import SpriteComponent from './sprite/effect.svelte';
import VideoBgComponent from './video-bg/effect.svelte';

export interface SpriteParams {
	image: string; lat: number; lon: number;
	altitude?: number; width?: number; height?: number;
}

export interface VideoBgParams {
	asset: string;
	fit?: 'cover' | 'contain' | 'fill';
	opacity?: number;
	blend?: 'normal' | 'screen' | 'multiply' | 'overlay';
}

export function createSpriteEffect(bundle: SpriteBundle): Effect<SpriteParams> {
	return {
		id: bundle.id, kind: bundle.kind, z: bundle.z,
		when: (model) => evalWhen(bundle.when, model),
		component: SpriteComponent,
		params: { image: bundle.image, lat: bundle.lat, lon: bundle.lon, altitude: bundle.altitude, width: bundle.width, height: bundle.height },
	};
}

export function createVideoBgEffect(bundle: VideoBgBundle): Effect<VideoBgParams> {
	return {
		id: bundle.id, kind: bundle.kind, z: bundle.z,
		when: (model) => evalWhen(bundle.when, model),
		component: VideoBgComponent,
		params: { asset: bundle.asset, fit: bundle.fit, opacity: bundle.opacity, blend: bundle.blend },
	};
}
