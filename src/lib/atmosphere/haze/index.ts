import type { Effect } from '$lib/scene/types';
import Component from './effect.svelte';

const atmosphericHaze: Effect = {
	id: 'atmospheric-haze',
	kind: 'atmo',
	// z:0 puts it after Cesium (z:0, DOM-order earlier) but before clouds (z:1).
	// CSS stacking is by DOM order at the same z-index, so this layers correctly.
	z: 0,
	component: Component,
};

export default atmosphericHaze;
