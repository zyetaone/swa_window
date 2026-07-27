/**
 * video-bg factory — VideoBgBundle → Effect<VideoBgParams>.
 *
 * Video-bg effect: full-scene HTML5 <video> loop.
 *   Hardware: <video> uses the browser's built-in decoder — Pi 5 gets
 *   VideoCore VII HW decode (cheap for 1080p, trivial for 720p).
 */

import type { Effect } from '../../types';
import type { VideoBgBundle } from '../../bundle/types';
import { evalWhen } from '../../bundle/types';
import VideoBgComponent from './effect.svelte';

export interface VideoBgParams {
	asset: string;
	fit?: 'cover' | 'contain' | 'fill';
	opacity?: number;
	blend?: 'normal' | 'screen' | 'multiply' | 'overlay';
}

export function createVideoBgEffect(bundle: VideoBgBundle): Effect<VideoBgParams> {
	return {
		id: bundle.id,
		kind: bundle.kind,
		z: bundle.z,
		when: (model) => evalWhen(bundle.when, model),
		component: VideoBgComponent,
		params: {
			asset: bundle.asset,
			fit: bundle.fit,
			opacity: bundle.opacity,
			blend: bundle.blend,
		},
	};
}